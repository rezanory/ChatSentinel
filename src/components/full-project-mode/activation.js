import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { validateProject } from '../../validation.js';

const PROFILE_URL = new URL('../../../config/project-profiles.json', import.meta.url);
let cachedProfile;

export async function loadFullProjectProfile() {
  if (cachedProfile) return structuredClone(cachedProfile);
  const parsed = JSON.parse(await fs.readFile(PROFILE_URL, 'utf8'));
  const profile = parsed?.profiles?.full;
  if (!profile || profile.command !== 'CHATSENTINEL FULL PROJECT MODE') {
    throw new Error('full-project-profile-invalid');
  }
  const required = [
    'autoRecovery', 'groupTabs', 'sessionSnapshots', 'selectiveRestore',
    'activeParallelChats', 'conversationDomCompaction', 'searchExportImport',
    'auditHistory', 'componentFirst', 'parallelLanes', 'canonicalHandoff',
    'antiBlocker', 'integrationController', 'runnerOnDemand', 'releaseRequiresAllGates'
  ];
  for (const key of required) {
    if (profile[key] !== true) throw new Error(`full-project-profile-${key}-required`);
  }
  cachedProfile = { profileId: 'full', schemaVersion: Number(parsed.schemaVersion || 1), ...profile };
  return structuredClone(cachedProfile);
}

export async function activateFullProjectMode(store, request = {}, options = {}) {
  const profileLoader = options.profileLoader || loadFullProjectProfile;
  const now = options.now || (() => new Date());
  const conversationId = clean(request.conversationId, 200);
  if (!conversationId) return { ok: false, error: 'conversationId-required' };

  const profile = await profileLoader();
  const currentConfig = store.getConfig(conversationId) || {};
  const resolved = resolveProject(store, currentConfig, request);
  if (!resolved.ok) return resolved;

  const instant = now().toISOString();
  const previousProject = resolved.project || null;
  let project = previousProject || createProject(resolved.draft, instant);
  if (!previousProject) {
    const checked = validateProject(project);
    if (!checked.ok) return { ok: false, error: checked.error };
    const occupied = store.getProject(project.projectId);
    if (occupied && pathKey(occupied.projectPath) !== pathKey(project.projectPath)) {
      return { ok: false, error: 'deterministic-project-id-conflict' };
    }
    project = { ...project, ...checked.value };
  }

  const orchestrationActivation = buildOrchestrationActivationPath(project, profile);
  const firstActivatedAt = project.fullProjectMode?.activatedAt || instant;
  const nextProject = {
    ...project,
    autoRecovery: true,
    groupTabs: true,
    capabilityProfile: profile,
    fullProjectMode: {
      active: true,
      profileId: profile.profileId,
      profileSchemaVersion: profile.schemaVersion,
      activatedAt: firstActivatedAt,
      lastActivatedAt: instant,
      orchestrationActivation
    },
    updatedAt: instant
  };

  const tabId = normalizeTabId(request.tabId);
  const title = clean(request.title, 300);
  const url = clean(request.url, 4096);
  const nextConfig = {
    ...currentConfig,
    conversationId,
    projectId: nextProject.projectId,
    projectPath: nextProject.projectPath,
    capabilityProfile: profile.profileId,
    attachedAt: currentConfig.attachedAt || instant,
    ...(tabId !== undefined ? { tabId } : {}),
    ...(title ? { title } : {}),
    ...(url ? { url } : {})
  };

  try {
    await store.setProject(nextProject.projectId, nextProject);
    await store.setConfig(conversationId, nextConfig);
  } catch (error) {
    await rollbackProject(store, nextProject.projectId, previousProject).catch(() => {});
    return {
      ok: false,
      error: 'full-project-mode-persist-failed',
      detail: String(error?.message || error)
    };
  }

  return {
    ok: true,
    created: !previousProject,
    project: nextProject,
    config: nextConfig,
    profile,
    orchestrationActivation
  };
}

export function buildOrchestrationActivationPath(project = {}, profile = {}) {
  return {
    version: 1,
    state: project?.orchestration?.enabled ? 'configured' : 'ready-for-plan',
    configure: {
      method: 'POST',
      route: '/orchestrator/configure',
      client: 'local-process'
    },
    tick: { method: 'POST', route: '/orchestrator/tick', client: 'local-process' },
    projectId: project.projectId,
    repoPath: project.projectPath,
    laneCommand: 'CREATE_LANE_CHAT',
    laneContract: ['laneId', 'branch', 'baselineSha', 'prompt'],
    independentLanesOnly: Boolean(profile.componentFirst && profile.parallelLanes),
    integrationController: Boolean(profile.integrationController)
  };
}

function resolveProject(store, config, request) {
  const attached = config.projectId ? store.getProject(config.projectId) : null;
  if (attached) return { ok: true, project: attached };

  const selectedProjectId = clean(request.selectedProjectId, 120);
  if (selectedProjectId) {
    const selected = store.getProject(selectedProjectId);
    return selected
      ? { ok: true, project: selected }
      : { ok: false, error: 'selected-project-not-found' };
  }

  const draft = normalizeDraft(request.projectDraft, config);
  const projectPath = draft.projectPath || clean(config.projectPath, 2048);
  if (projectPath) {
    const match = Object.values(store.projects || {}).find(project =>
      pathKey(project?.projectPath) === pathKey(projectPath));
    if (match) return { ok: true, project: match };
    return {
      ok: true,
      draft: { ...draft, projectPath, name: draft.name || projectNameFromPath(projectPath) }
    };
  }

  return { ok: false, error: 'project-selection-required' };
}

function normalizeDraft(value, config) {
  const draft = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  return {
    name: clean(draft.name, 120),
    projectPath: clean(draft.projectPath, 2048),
    folderPath: clean(draft.folderPath, 600),
    operationClass: clean(draft.operationClass || config.operationClass, 40).toLowerCase(),
    color: clean(draft.color, 20).toLowerCase() || 'blue'
  };
}

function createProject(draft, instant) {
  return {
    projectId: deterministicProjectId(draft.projectPath),
    name: draft.name || projectNameFromPath(draft.projectPath),
    projectPath: draft.projectPath,
    folderPath: draft.folderPath || '',
    operationClass: draft.operationClass || '',
    autoRecovery: true,
    groupTabs: true,
    color: draft.color || 'blue',
    createdAt: instant,
    updatedAt: instant
  };
}

export function deterministicProjectId(projectPath) {
  const digest = createHash('sha256').update(pathKey(projectPath)).digest('hex').slice(0, 20);
  return `project:full:${digest}`;
}

function projectNameFromPath(projectPath) {
  const parts = clean(projectPath, 2048)
    .replace(/[\\/]+$/, '')
    .split(/[\\/]/)
    .filter(Boolean);
  return parts.at(-1) || 'ChatSentinel Project';
}

function pathKey(value) {
  return clean(value, 2048)
    .replace(/[\\/]+$/, '')
    .replace(/\\/g, '/')
    .toLowerCase();
}

function normalizeTabId(value) {
  if (value === undefined || value === null || value === '') return undefined;
  const number = Number(value);
  return Number.isInteger(number) && number >= 0 && number <= 2 ** 31 - 1
    ? number
    : undefined;
}

async function rollbackProject(store, projectId, previousProject) {
  if (previousProject) return store.setProject(projectId, previousProject);
  return store.deleteProject(projectId);
}

function clean(value, max = 4096) {
  if (typeof value !== 'string' && typeof value !== 'number') return '';
  const text = String(value).trim();
  return text && text.length <= max ? text : '';
}
