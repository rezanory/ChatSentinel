(function initSessionSnapshotStore(root) {
  'use strict';

  const STORAGE_KEY = 'sessionSnapshots:v1';
  const SCHEMA_VERSION = 1;
  const DEFAULT_MAX_PER_PROJECT = 12;
  const DEFAULT_TTL_MS = 30 * 24 * 60 * 60 * 1000;
  const GROUP_COLORS = new Set(['grey', 'blue', 'red', 'yellow', 'green', 'pink', 'purple', 'cyan', 'orange']);

  class SessionSnapshotStore {
    constructor({
      storage,
      key = STORAGE_KEY,
      maxPerProject = DEFAULT_MAX_PER_PROJECT,
      ttlMs = DEFAULT_TTL_MS,
      clock = () => Date.now(),
      idFactory = defaultIdFactory
    } = {}) {
      if (!storage?.get || !storage?.set) throw new TypeError('storage-get-set-required');
      this.storage = storage;
      this.key = key;
      this.maxPerProject = Math.max(1, Number(maxPerProject) || DEFAULT_MAX_PER_PROJECT);
      this.ttlMs = Math.max(1, Number(ttlMs) || DEFAULT_TTL_MS);
      this.clock = clock;
      this.idFactory = idFactory;
      this.serial = Promise.resolve();
    }

    saveProjectSnapshot(input) {
      return this._enqueue(async () => {
        const state = await this._readState();
        const snapshot = normalizeSnapshot(input, { now: this.clock(), id: this.idFactory() });
        const latest = state.snapshots.filter(row => row?.projectId === snapshot.projectId).sort(newestFirst)[0];
        if (latest && sameSnapshotContent(latest, snapshot)) return clone(latest);
        state.snapshots.push(snapshot);
        state.snapshots = pruneSnapshots(state.snapshots, {
          now: this.clock(),
          ttlMs: this.ttlMs,
          maxPerProject: this.maxPerProject
        });
        await this._writeState(state);
        return clone(snapshot);
      });
    }

    list(projectId) {
      return this._enqueue(async () => {
        const state = await this._readState();
        const pruned = pruneSnapshots(state.snapshots, {
          now: this.clock(),
          ttlMs: this.ttlMs,
          maxPerProject: this.maxPerProject
        });
        if (pruned.length !== state.snapshots.length) {
          state.snapshots = pruned;
          await this._writeState(state);
        }
        const rows = projectId ? pruned.filter(snapshot => snapshot.projectId === projectId) : pruned;
        return clone(rows.sort(newestFirst));
      });
    }

    async latest(projectId) {
      const rows = await this.list(projectId);
      return rows[0] || null;
    }

    async latestPerProject() {
      const rows = await this.list();
      const latest = new Map();
      for (const row of rows) {
        if (!latest.has(row.projectId)) latest.set(row.projectId, row);
      }
      return [...latest.values()];
    }

    async get(snapshotId) {
      const id = cleanString(snapshotId, 240);
      if (!id) return null;
      const rows = await this.list();
      return rows.find(snapshot => snapshot.snapshotId === id) || null;
    }

    remove(snapshotId) {
      return this._enqueue(async () => {
        const id = cleanString(snapshotId, 240);
        const state = await this._readState();
        const before = state.snapshots.length;
        state.snapshots = state.snapshots.filter(snapshot => snapshot.snapshotId !== id);
        if (state.snapshots.length !== before) await this._writeState(state);
        return before !== state.snapshots.length;
      });
    }

    clearProject(projectId) {
      return this._enqueue(async () => {
        const id = cleanString(projectId, 160);
        if (!id) return 0;
        const state = await this._readState();
        const before = state.snapshots.length;
        state.snapshots = state.snapshots.filter(snapshot => snapshot.projectId !== id);
        const removed = before - state.snapshots.length;
        if (removed) await this._writeState(state);
        return removed;
      });
    }

    prune() {
      return this._enqueue(async () => {
        const state = await this._readState();
        const before = state.snapshots.length;
        state.snapshots = pruneSnapshots(state.snapshots, {
          now: this.clock(),
          ttlMs: this.ttlMs,
          maxPerProject: this.maxPerProject
        });
        if (state.snapshots.length !== before) await this._writeState(state);
        return before - state.snapshots.length;
      });
    }

    _enqueue(work) {
      const run = this.serial.then(work, work);
      this.serial = run.then(() => undefined, () => undefined);
      return run;
    }

    async _readState() {
      const raw = await this.storage.get(this.key);
      return normalizeState(raw?.[this.key]);
    }

    async _writeState(state) {
      await this.storage.set({ [this.key]: { schemaVersion: SCHEMA_VERSION, snapshots: state.snapshots } });
    }
  }

  function normalizeState(value) {
    if (!value || typeof value !== 'object' || !Array.isArray(value.snapshots)) {
      return { schemaVersion: SCHEMA_VERSION, snapshots: [] };
    }
    return { schemaVersion: SCHEMA_VERSION, snapshots: value.snapshots.map(normalizeStoredSnapshot).filter(Boolean) };
  }

  function normalizeStoredSnapshot(value) {
    if (!value || typeof value !== 'object') return null;
    const snapshotId = cleanString(value.snapshotId, 240);
    const projectId = cleanString(value.projectId || value.project?.projectId, 160);
    const createdAtMs = Date.parse(value.createdAt || '');
    if (!snapshotId || !projectId || !Number.isFinite(createdAtMs)) return null;
    const project = normalizeProject({ ...value.project, projectId });
    const groups = normalizeGroups(value.groups);
    return {
      schemaVersion: SCHEMA_VERSION,
      snapshotId,
      projectId,
      project,
      createdAt: new Date(createdAtMs).toISOString(),
      reason: cleanString(value.reason || 'unknown', 80) || 'unknown',
      groups,
      tabCount: groups.reduce((count, group) => count + group.tabs.length, 0)
    };
  }

  function normalizeSnapshot(value, { now, id }) {
    if (!value || typeof value !== 'object') throw new TypeError('snapshot-required');
    const project = normalizeProject(value.project || value);
    if (!project.projectId) throw new TypeError('projectId-required');
    const groups = normalizeGroups(value.groups);
    const createdAt = new Date(Number(now)).toISOString();
    const suffix = cleanString(id, 80) || String(Number(now));
    return {
      schemaVersion: SCHEMA_VERSION,
      snapshotId: `${project.projectId}:${Number(now)}:${suffix}`,
      projectId: project.projectId,
      project,
      createdAt,
      reason: cleanString(value.reason || 'manual', 80) || 'manual',
      groups,
      tabCount: groups.reduce((count, group) => count + group.tabs.length, 0)
    };
  }

  function normalizeProject(value = {}) {
    return {
      projectId: cleanString(value.projectId, 160),
      name: cleanString(value.name || 'ChatSentinel Project', 160) || 'ChatSentinel Project',
      color: normalizeGroupColor(value.color),
      groupTabs: value.groupTabs !== false
    };
  }

  function normalizeGroups(value) {
    if (!Array.isArray(value)) return [];
    const groups = [];
    for (let groupIndex = 0; groupIndex < value.length; groupIndex += 1) {
      const group = value[groupIndex] || {};
      const tabs = [];
      for (let tabIndex = 0; tabIndex < (group.tabs || []).length; tabIndex += 1) {
        const tab = normalizeTab(group.tabs[tabIndex], groupIndex, tabIndex);
        if (tab) tabs.push(tab);
      }
      if (!tabs.length) continue;
      groups.push({
        groupKey: cleanString(group.groupKey, 160) || `group:${groupIndex}`,
        title: cleanString(group.title || 'ChatSentinel Project', 160) || 'ChatSentinel Project',
        color: normalizeGroupColor(group.color),
        collapsed: Boolean(group.collapsed),
        windowOrdinal: finiteInteger(group.windowOrdinal, 0),
        tabs
      });
    }
    return groups;
  }

  function normalizeTab(value, groupIndex, tabIndex) {
    if (!value || typeof value !== 'object') return null;
    const url = normalizeRestorableUrl(value.url);
    if (!url) return null;
    const conversationId = cleanString(value.conversationId, 220);
    const fallbackEntry = `${conversationId || 'url'}:${groupIndex}:${tabIndex}`;
    return {
      entryId: cleanString(value.entryId, 260) || fallbackEntry,
      conversationId,
      title: cleanString(value.title, 300),
      url,
      pinned: Boolean(value.pinned),
      active: Boolean(value.active),
      index: finiteInteger(value.index, tabIndex)
    };
  }

  function pruneSnapshots(rows, { now, ttlMs, maxPerProject }) {
    const floor = Number(now) - Number(ttlMs);
    const valid = rows.map(normalizeStoredSnapshot).filter(Boolean)
      .filter(snapshot => Date.parse(snapshot.createdAt) >= floor).sort(newestFirst);
    const counts = new Map();
    return valid.filter(snapshot => {
      const count = counts.get(snapshot.projectId) || 0;
      if (count >= maxPerProject) return false;
      counts.set(snapshot.projectId, count + 1);
      return true;
    });
  }

  function normalizeRestorableUrl(value) {
    if (typeof value !== 'string' || value.length > 4096) return '';
    try {
      const url = new URL(value);
      const host = url.hostname.toLowerCase();
      const chatGpt = url.protocol === 'https:' && (host === 'chatgpt.com' || host.endsWith('.chatgpt.com'));
      const fixture = url.protocol === 'http:' && (host === '127.0.0.1' || host === 'localhost');
      if (!chatGpt && !fixture) return '';
      url.hash = '';
      if (chatGpt) {
        const match = url.pathname.match(/^\/c\/([A-Za-z0-9_-]+)/);
        url.pathname = match ? `/c/${match[1]}` : '/';
        url.search = '';
      }
      return url.toString();
    } catch {
      return '';
    }
  }

  function normalizeGroupColor(value) {
    const color = cleanString(value || 'blue', 20).toLowerCase();
    return GROUP_COLORS.has(color) ? color : 'blue';
  }

  function sameSnapshotContent(a, b) {
    return JSON.stringify({ project: a.project, groups: a.groups }) === JSON.stringify({ project: b.project, groups: b.groups });
  }

  function newestFirst(a, b) { return Date.parse(b.createdAt) - Date.parse(a.createdAt); }

  function finiteInteger(value, fallback = 0) {
    const number = Number(value);
    return Number.isInteger(number) && number >= 0 ? number : fallback;
  }

  function cleanString(value, max) {
    if (typeof value !== 'string' && typeof value !== 'number') return '';
    const text = String(value).trim();
    return text && text.length <= max ? text : '';
  }

  function defaultIdFactory() {
    try { if (root.crypto?.randomUUID) return root.crypto.randomUUID(); } catch {}
    return Math.random().toString(36).slice(2);
  }

  function clone(value) { return value === undefined ? undefined : JSON.parse(JSON.stringify(value)); }

  root.ChatSentinelSessionSnapshots = Object.freeze({ SessionSnapshotStore, normalizeRestorableUrl });
})(globalThis);