import fs from 'node:fs/promises';
import path from 'node:path';

const EMPTY_STATE = Object.freeze({
  schemaVersion: 1,
  configs: {},
  sessions: {},
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
      this.prune();
      return this.state;
    } catch (error) {
      if (error.code === 'ENOENT') return this.state;
      await this.quarantineCorruptFile().catch(() => {});
      this.onError(error);
      this.state = structuredClone(EMPTY_STATE);
      return this.state;
    }
  }

  get configs() { return this.state.configs; }
  get sessions() { return this.state.sessions; }
  get meta() { return this.state.meta; }

  getConfig(id) { return this.state.configs[id] || {}; }
  getSession(id) { return this.state.sessions[id] || {}; }

  async setConfig(id, value) {
    this.state.configs[id] = value;
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
    schemaVersion: 1,
    configs: isRecord(value.configs) ? value.configs : {},
    sessions: isRecord(value.sessions) ? value.sessions : {},
    meta: isRecord(value.meta) ? value.meta : {}
  };
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
