import { createHash } from 'node:crypto';

export const PORTABLE_KIND = 'chatsentinel-project-bundle';
export const PORTABLE_SCHEMA_VERSION = 1;

export function createPortableBundle(store, options = {}) {
  const selectedIds = new Set((options.projectIds || []).filter(Boolean));
  const includeAll = selectedIds.size === 0;
  const projects = Object.values(store.projects || {})
    .filter(project => includeAll || selectedIds.has(project.projectId))
    .map(project => portableProject(project));
  const allowed = new Set(projects.map(project => project.projectId));
  const configs = {};
  const recoverySnapshots = {};
  for (const [conversationId, config] of Object.entries(store.configs || {})) {
    if (!allowed.has(config?.projectId)) continue;
    configs[conversationId] = portableConfig(config);
    if (options.includeRecoverySnapshots !== false) {
      const session = store.getSession(conversationId);
      if (session && Object.keys(session).length) recoverySnapshots[conversationId] = portableSnapshot(session);
    }
  }
  return {
    kind: PORTABLE_KIND,
    schemaVersion: PORTABLE_SCHEMA_VERSION,
    createdAt: new Date().toISOString(),
    projects,
    configs,
    recoverySnapshots
  };
}

export function validatePortableBundle(bundle) {
  if (!isRecord(bundle)) return invalid('bundle-object-required');
  if (bundle.kind !== PORTABLE_KIND) return invalid('bundle-kind-invalid');
  if (bundle.schemaVersion !== PORTABLE_SCHEMA_VERSION) return invalid('bundle-schema-unsupported');
  if (!Array.isArray(bundle.projects) || !isRecord(bundle.configs) || !isRecord(bundle.recoverySnapshots || {})) {
    return invalid('bundle-shape-invalid');
  }
  const ids = new Set();
  for (const project of bundle.projects) {
    if (!isRecord(project) || !clean(project.projectId, 120) || !clean(project.name, 120) || !clean(project.projectPath, 2048)) {
      return invalid('project-invalid');
    }
    if (ids.has(project.projectId)) return invalid('project-duplicate');
    ids.add(project.projectId);
  }
  for (const [conversationId, config] of Object.entries(bundle.configs)) {
    if (!clean(conversationId, 200) || !isRecord(config) || !ids.has(config.projectId)) {
      return invalid('config-invalid');
    }
  }
  for (const [conversationId, snapshot] of Object.entries(bundle.recoverySnapshots || {})) {
    if (!bundle.configs[conversationId] || !isRecord(snapshot)) return invalid('snapshot-invalid');
  }
  return { ok: true, value: bundle };
}

export function previewPortableImport(store, bundle) {
  const validated = validatePortableBundle(bundle);
  if (!validated.ok) return validated;
  const preview = {
    projectsCreate: 0, projectsUpdate: 0,
    configsCreate: 0, configsUpdate: 0,
    recoverySnapshots: Object.keys(bundle.recoverySnapshots || {}).length,
    conflicts: []
  };
  for (const project of bundle.projects) {
    const existing = store.getProject(project.projectId);
    existing ? preview.projectsUpdate++ : preview.projectsCreate++;
    if (existing?.projectPath && existing.projectPath !== project.projectPath) {
      preview.conflicts.push({ type: 'project-path-change', projectId: project.projectId, from: existing.projectPath, to: project.projectPath });
    }
  }
  for (const [conversationId, config] of Object.entries(bundle.configs)) {
    const existing = store.getConfig(conversationId);
    Object.keys(existing).length ? preview.configsUpdate++ : preview.configsCreate++;
    if (existing.projectId && existing.projectId !== config.projectId) {
      preview.conflicts.push({ type: 'conversation-project-change', conversationId, from: existing.projectId, to: config.projectId });
    }
  }
  return { ok: true, preview, previewToken: bundleToken(bundle) };
}
export async function applyPortableImport(store, bundle, options = {}) {
  const preview = previewPortableImport(store, bundle);
  if (!preview.ok) return preview;
  if (!options.previewToken || options.previewToken !== preview.previewToken) {
    return invalid('preview-token-required');
  }
  for (const project of bundle.projects) {
    const existing = store.getProject(project.projectId) || {};
    await store.setProject(project.projectId, { ...existing, ...portableProject(project), updatedAt: new Date().toISOString() });
  }
  for (const [conversationId, config] of Object.entries(bundle.configs)) {
    const existing = store.getConfig(conversationId) || {};
    await store.setConfig(conversationId, { ...existing, ...portableConfig(config) });
  }
  if (options.applyRecoverySnapshots === true) {
    for (const [conversationId, snapshot] of Object.entries(bundle.recoverySnapshots || {})) {
      store.setSession(conversationId, { ...snapshot, importedAt: new Date().toISOString() });
    }
    await store.flush();
  }
  return { ok: true, applied: preview.preview, previewToken: preview.previewToken };
}

function portableProject(project) {
  const value = {};
  for (const key of ['projectId','name','projectPath','operationClass','autoRecovery','groupTabs','color','createdAt','updatedAt']) {
    if (project?.[key] !== undefined) value[key] = project[key];
  }
  return value;
}

function portableConfig(config) {
  const value = {};
  for (const key of ['projectId','projectPath','operationClass','tabId','title','url']) {
    if (config?.[key] !== undefined) value[key] = config[key];
  }
  return value;
}
function portableSnapshot(session) {
  const value = {};
  for (const key of ['state','decision','updatedAt','progressAgeMs','sideEffectRisk','checkpointFresh','projectId','projectName','projectPath','operationClass','autoRecovery','title','url','tabId']) {
    if (session?.[key] !== undefined) value[key] = session[key];
  }
  return value;
}

function bundleToken(bundle) {
  const canonical = JSON.stringify({
    kind: bundle.kind,
    schemaVersion: bundle.schemaVersion,
    projects: bundle.projects,
    configs: bundle.configs,
    recoverySnapshots: bundle.recoverySnapshots || {}
  });
  return createHash('sha256').update(canonical).digest('hex');
}

function clean(value, max) {
  return typeof value === 'string' && value.trim().length > 0 && value.trim().length <= max;
}
function isRecord(value) { return Boolean(value && typeof value === 'object' && !Array.isArray(value)); }
function invalid(error) { return { ok: false, error }; }
