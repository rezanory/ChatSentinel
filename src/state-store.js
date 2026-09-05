import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';

const EMPTY_STATE = Object.freeze({
  schemaVersion: 3,
  projects: {},
  configs: {},
  sessions: {},
  commands: {},
  meta: {}
});

export class StateStore {
  constructor({ file, maxSessions = 500, sessionTtlMs = 86_400_000, onError = () => {} }) {
    this.file = file;
    this.maxSessions = maxSessions;
    this.sessionTtlMs = sessionTtlMs;
    this.onError = onError;
    this.state = structuredClone(EMPTY_STATE);
    this.saveTimer = null;
    this.saving = Promise.resolve();
  }

  async load() {
    await fs.mkdir(path.dirname(this.file), { recursive: true });
    try {
      const raw = await fs.readFile(this.file, 'utf8');
      this.state = normalizeState(JSON.parse(raw));
      const migrated = migrateLegacyProjects(this.state);
      this.prune();
      if (migrated) await this.saveNow();
      return this.state;
    } catch (error) {
      if (error.code === 'ENOENT') return this.state;
      await this.quarantineCorruptFile().catch(() => {});
      this.onError(error);
      this.state = structuredClone(EMPTY_STATE);
      return this.state;
    }
  }

  get projects() { return this.state.projects; }
  get configs() { return this.state.configs; }
  get sessions() { return this.state.sessions; }
  get commands() { return this.state.commands; }
  get meta() { return this.state.meta; }

  getProject(id) { return this.state.projects[id] || null; }
  getConfig(id) { return this.state.configs[id] || {}; }
  getSession(id) { return this.state.sessions[id] || {}; }

  async setProject(id, value) {
    this.state.projects[id] = value;
    await this.saveNow();
  }

  async deleteProject(id) {
    const project = this.state.projects[id];
    delete this.state.projects[id];
    for (const config of Object.values(this.state.configs)) {
      if (config?.projectId !== id) continue;
      delete config.projectId;
      if (project?.projectPath && config.projectPath === project.projectPath) delete config.projectPath;
    }
    await this.saveNow();
  }

  async setConfig(id, value) {
    this.state.configs[id] = value;
    await this.saveNow();
  }

  async deleteConfig(id) {
    delete this.state.configs[id];
    delete this.state.sessions[id];
    await this.saveNow();
  }

  setSession(id, value) {
    this.state.sessions[id] = value;
    this.prune();
    this.scheduleSave();
  }

  setMeta(key, value) {
    this.state.meta[key] = value;
    this.scheduleSave();
  }

  deleteSession(id) {
    delete this.state.sessions[id];
    this.scheduleSave();
  }

  prune(now = Date.now()) {
    const rows = Object.entries(this.state.sessions);
    for (const [id, row] of rows) {
      const updated = Date.parse(row?.updatedAt || '');
      if (Number.isFinite(updated) && now - updated > this.sessionTtlMs) {
        delete this.state.sessions[id];
      }
    }

    const remaining = Object.entries(this.state.sessions);
    if (remaining.length <= this.maxSessions) return;
    remaining.sort((a, b) => Date.parse(a[1]?.updatedAt || 0) - Date.parse(b[1]?.updatedAt || 0));
    for (const [id] of remaining.slice(0, remaining.length - this.maxSessions)) {
      delete this.state.sessions[id];
    }
  }

  scheduleSave(delayMs = 300) {
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      this.saveNow().catch(this.onError);
    }, delayMs);
    this.saveTimer.unref?.();
  }

  async saveNow() {
    this.prune();
    const snapshot = JSON.stringify(this.state, null, 2);
    this.saving = this.saving.then(async () => {
      await fs.mkdir(path.dirname(this.file), { recursive: true });
      const temp = `${this.file}.${process.pid}.tmp`;
      await fs.writeFile(temp, snapshot, { encoding: 'utf8', mode: 0o600 });
      await replaceFile(temp, this.file);
    });
    return this.saving;
  }

  async flush() {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    await this.saveNow();
  }

  async quarantineCorruptFile() {
    const quarantine = `${this.file}.corrupt-${Date.now()}`;
    await fs.rename(this.file, quarantine);
  }
}

function normalizeState(value) {
  if (!value || typeof value !== 'object') return structuredClone(EMPTY_STATE);
  return {
    schemaVersion: 3,
    projects: isRecord(value.projects) ? value.projects : {},
    configs: isRecord(value.configs) ? value.configs : {},
    sessions: isRecord(value.sessions) ? value.sessions : {},
    commands: isRecord(value.commands) ? value.commands : {},
    meta: isRecord(value.meta) ? value.meta : {}
  };
}


function migrateLegacyProjects(state) {
  let changed = false;
  const byPath = new Map();
  for (const [conversationId, config] of Object.entries(state.configs)) {
    if (!config?.projectPath || config.projectId) continue;
    const normalizedPath = String(config.projectPath).trim();
    if (!normalizedPath) continue;
    let projectId = byPath.get(normalizedPath);
    if (!projectId) {
      const digest = createHash('sha256').update(normalizedPath.toLowerCase()).digest('hex').slice(0, 16);
      projectId = `project:legacy:${digest}`;
      byPath.set(normalizedPath, projectId);
      if (!state.projects[projectId]) {
        const now = new Date().toISOString();
        state.projects[projectId] = {
          projectId,
          name: portableBasename(normalizedPath) || 'Migrated Project',
          projectPath: normalizedPath,
          operationClass: config.operationClass || '',
          autoRecovery: false,
          groupTabs: true,
          color: 'blue',
          createdAt: now,
          updatedAt: now,
          migratedFromV1: true
        };
      }
    }
    state.configs[conversationId] = { ...config, projectId };
    changed = true;
  }
  return changed;
}
function portableBasename(value) {
  return String(value || '').replace(/[\\/]+$/, '').split(/[\\/]/).filter(Boolean).at(-1) || '';
}

function isRecord(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

async function replaceFile(temp, target) {
  try {
    await fs.rename(temp, target);
  } catch (error) {
    if (!['EEXIST', 'EPERM'].includes(error.code)) throw error;
    await fs.rm(target, { force: true });
    await fs.rename(temp, target);
  }
}
