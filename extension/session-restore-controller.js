(function initSessionRestoreController(root) {
  'use strict';

  const snapshotsApi = root.ChatSentinelSessionSnapshots;
  if (!snapshotsApi?.normalizeRestorableUrl) throw new Error('session-snapshot-store-required');
  const { normalizeRestorableUrl } = snapshotsApi;

  class SessionRestoreController {
    constructor({
      chromeApi,
      snapshotStore,
      apiRequest,
      onError = () => {},
      captureDelayMs = 500,
      startupSettleMs = 1500
    } = {}) {
      if (!chromeApi?.tabs || !chromeApi?.tabGroups || !chromeApi?.storage?.local) {
        throw new TypeError('chrome-tabs-tabGroups-storage-required');
      }
      if (!snapshotStore?.saveProjectSnapshot || !snapshotStore?.latestPerProject) {
        throw new TypeError('snapshot-store-required');
      }
      if (typeof apiRequest !== 'function') throw new TypeError('apiRequest-required');
      this.chrome = chromeApi;
      this.snapshotStore = snapshotStore;
      this.apiRequest = apiRequest;
      this.onError = onError;
      this.captureDelayMs = Math.max(0, Number(captureDelayMs) || 0);
      this.startupSettleMs = Math.max(0, Number(startupSettleMs) || 0);
      this.captureTimer = null;
    }

    scheduleCaptureAll(reason = 'browser-change') {
      if (this.captureTimer) clearTimeout(this.captureTimer);
      this.captureTimer = setTimeout(() => {
        this.captureTimer = null;
        this.captureAllProjects(reason).catch(this.onError);
      }, this.captureDelayMs);
    }

    async captureAllProjects(reason = 'automatic') {
      const response = await this.apiRequest('/projects');
      if (!response?.ok || !Array.isArray(response.projects)) throw new Error('projects-unavailable');
      const snapshots = [];
      const failures = [];
      for (const project of response.projects) {
        try {
          snapshots.push(await this.captureProject(project, reason));
        } catch (error) {
          failures.push({ projectId: project?.projectId || '', error: String(error) });
        }
      }
      return { ok: failures.length === 0, snapshots, failures };
    }

    async captureProjectById(projectId, reason = 'manual') {
      const response = await this.apiRequest('/projects');
      if (!response?.ok || !Array.isArray(response.projects)) throw new Error('projects-unavailable');
      const project = response.projects.find(row => row.projectId === projectId);
      if (!project) throw new Error('project-not-found');
      return this.captureProject(project, reason);
    }

    async captureProject(project, reason = 'manual') {
      if (!project?.projectId) throw new TypeError('project-required');
      const chats = Array.isArray(project.chats) ? project.chats : [];
      const rows = [];
      const groupCache = new Map();
      const windows = [];

      for (let index = 0; index < chats.length; index += 1) {
        const chat = chats[index] || {};
        const liveTab = await this._liveTab(chat.tabId);
        const url = normalizeRestorableUrl(liveTab?.url || chat.url);
        if (!url) continue;
        const windowId = Number.isInteger(liveTab?.windowId) ? liveTab.windowId : null;
        if (windowId !== null && !windows.includes(windowId)) windows.push(windowId);
        const groupId = Number.isInteger(liveTab?.groupId) && liveTab.groupId >= 0 ? liveTab.groupId : -1;
        let groupMeta = null;
        if (groupId >= 0) {
          if (!groupCache.has(groupId)) groupCache.set(groupId, await this._groupMeta(groupId));
          groupMeta = groupCache.get(groupId);
        }
        rows.push({
          groupKey: `${windowId ?? 'fallback'}:${groupId >= 0 ? groupId : 'ungrouped'}`,
          windowOrdinal: windowId === null ? 0 : windows.indexOf(windowId),
          groupTitle: groupMeta?.title || project.name || 'ChatSentinel Project',
          groupColor: groupMeta?.color || project.color || 'blue',
          groupCollapsed: Boolean(groupMeta?.collapsed),
          tab: {
            entryId: `${chat.conversationId || 'url'}:${index}`,
            conversationId: chat.conversationId || '',
            title: liveTab?.title || chat.title || '',
            url,
            pinned: Boolean(liveTab?.pinned),
            active: Boolean(liveTab?.active),
            index: Number.isInteger(liveTab?.index) ? liveTab.index : index
          }
        });
      }

      const groupMap = new Map();
      for (const row of rows) {
        if (!groupMap.has(row.groupKey)) {
          groupMap.set(row.groupKey, {
            groupKey: row.groupKey,
            title: row.groupTitle,
            color: row.groupColor,
            collapsed: row.groupCollapsed,
            windowOrdinal: row.windowOrdinal,
            tabs: []
          });
        }
        groupMap.get(row.groupKey).tabs.push(row.tab);
      }
      const groups = [...groupMap.values()]
        .map(group => ({ ...group, tabs: group.tabs.sort((a, b) => a.index - b.index) }))
        .sort((a, b) => a.windowOrdinal - b.windowOrdinal || a.groupKey.localeCompare(b.groupKey));

      return this.snapshotStore.saveProjectSnapshot({
        project: {
          projectId: project.projectId,
          name: project.name,
          color: project.color,
          groupTabs: project.groupTabs !== false
        },
        groups,
        reason
      });
    }

    listSnapshots(projectId) {
      return this.snapshotStore.list(projectId);
    }

    restoreSnapshot(snapshotId, options = {}) {
      return this.snapshotStore.get(snapshotId).then(snapshot => {
        if (!snapshot) return { ok: false, error: 'snapshot-not-found', snapshotId };
        return this._restoreSnapshotRecord(snapshot, options);
      });
    }

    async restoreLatest(projectId, options = {}) {
      const snapshot = await this.snapshotStore.latest(projectId);
      if (!snapshot) return { ok: false, error: 'snapshot-not-found', projectId };
      return this._restoreSnapshotRecord(snapshot, options);
    }

    async restoreAfterBrowserRestart({ projectIds } = {}) {
      if (this.startupSettleMs > 0) await sleep(this.startupSettleMs);
      const allow = Array.isArray(projectIds) && projectIds.length ? new Set(projectIds) : null;
      const snapshots = (await this.snapshotStore.latestPerProject())
        .filter(snapshot => !allow || allow.has(snapshot.projectId));
      const results = [];
      const failures = [];
      for (const snapshot of snapshots) {
        if (!snapshot.tabCount) {
          results.push({ ok: true, snapshotId: snapshot.snapshotId, projectId: snapshot.projectId, skipped: 'empty-snapshot' });
          continue;
        }
        try {
          const result = await this._restoreSnapshotRecord(snapshot, { activate: false });
          results.push(result);
          if (!result.ok) failures.push({ projectId: snapshot.projectId, error: result.error || 'restore-partial' });
        } catch (error) {
          failures.push({ projectId: snapshot.projectId, error: String(error) });
        }
      }
      return { ok: failures.length === 0, results, failures };
    }

    async switchProject(projectId) {
      const result = await this.restoreLatest(projectId, { activate: true });
      return { ...result, projectId };
    }

    async _restoreSnapshotRecord(snapshot, options = {}) {
      const selected = selectEntries(snapshot, options);
      if (!selected.total) {
        return { ok: true, snapshotId: snapshot.snapshotId, projectId: snapshot.projectId, restored: 0, skipped: 'selection-empty', failures: [] };
      }

      const liveTabs = await this.chrome.tabs.query({});
      const pools = buildUrlPools(liveTabs);
      const usedTabIds = new Set();
      const failures = [];
      const attachFailures = [];
      const groupResults = [];
      let created = 0;
      let reused = 0;
      let firstTab = null;
      const baseWindowId = await this._resolveWindowId(options.targetWindowId);

      for (const group of snapshot.groups) {
        const entries = group.tabs.filter(entry => selected.ids.has(entry.entryId));
        if (!entries.length) continue;
        let groupWindowId = Number.isInteger(options.targetWindowId) ? options.targetWindowId : null;
        if (groupWindowId === null) groupWindowId = preferredWindowForEntries(entries, pools, usedTabIds) ?? baseWindowId;
        const tabIds = [];

        for (const entry of entries) {
          try {
            let tab = takeExistingTab(pools, entry.url, usedTabIds, groupWindowId);
            if (tab) {
              reused += 1;
            } else {
              tab = await this._createTab(entry, groupWindowId);
              created += 1;
            }
            if (groupWindowId === null && Number.isInteger(tab.windowId)) groupWindowId = tab.windowId;
            usedTabIds.add(tab.id);
            tabIds.push(tab.id);
            firstTab ||= tab;
            await this.chrome.tabs.update(tab.id, { pinned: Boolean(entry.pinned) }).catch(() => {});
            try {
              await this._reattach(snapshot.projectId, entry, tab);
            } catch (error) {
              attachFailures.push({ entryId: entry.entryId, tabId: tab.id, error: String(error) });
            }
          } catch (error) {
            failures.push({ phase: 'tab-restore', entryId: entry.entryId, error: String(error) });
          }
        }

        if (tabIds.length && snapshot.project.groupTabs !== false) {
          try {
            const createProperties = Number.isInteger(groupWindowId) ? { windowId: groupWindowId } : undefined;
            const groupId = await this.chrome.tabs.group({ tabIds, ...(createProperties ? { createProperties } : {}) });
            await this.chrome.tabGroups.update(groupId, {
              title: group.title || snapshot.project.name,
              color: group.color || snapshot.project.color,
              collapsed: Boolean(group.collapsed)
            });
            groupResults.push({ groupId, tabIds, windowId: groupWindowId });
          } catch (error) {
            failures.push({ phase: 'group-restore', groupKey: group.groupKey, tabIds, error: String(error) });
          }
        }
      }

      if (options.activate !== false && firstTab?.id) {
        try {
          if (Number.isInteger(firstTab.windowId)) await this.chrome.windows.update(firstTab.windowId, { focused: true });
          await this.chrome.tabs.update(firstTab.id, { active: true });
        } catch (error) {
          failures.push({ phase: 'activate-project', tabId: firstTab.id, error: String(error) });
        }
      }

      return {
        ok: failures.length === 0,
        snapshotId: snapshot.snapshotId,
        projectId: snapshot.projectId,
        restored: created + reused,
        created,
        reused,
        groups: groupResults,
        failures,
        attachFailures
      };
    }

    async _liveTab(tabId) {
      const id = Number(tabId);
      if (!Number.isInteger(id)) return null;
      try { return await this.chrome.tabs.get(id); } catch { return null; }
    }

    async _groupMeta(groupId) {
      try { return await this.chrome.tabGroups.get(groupId); } catch { return null; }
    }

    async _resolveWindowId(requested) {
      if (Number.isInteger(Number(requested))) return Number(requested);
      try {
        const window = await this.chrome.windows.getLastFocused();
        return Number.isInteger(window?.id) ? window.id : null;
      } catch {
        return null;
      }
    }

    async _createTab(entry, windowId) {
      const create = { url: entry.url, active: false, pinned: Boolean(entry.pinned) };
      if (Number.isInteger(windowId)) create.windowId = windowId;
      try {
        return await this.chrome.tabs.create(create);
      } catch (error) {
        if (!Number.isInteger(windowId)) throw error;
        delete create.windowId;
        return this.chrome.tabs.create(create);
      }
    }

    async _reattach(projectId, entry, tab) {
      const fallback = /^tab:\d+$/.test(entry.conversationId || '');
      const conversationId = fallback || !entry.conversationId ? `tab:${tab.id}` : entry.conversationId;
      if (fallback || !entry.conversationId) {
        await this.chrome.storage.local.set({ [`pendingProject:${tab.id}`]: projectId });
      }
      const response = await this.apiRequest('/projects/attach', 'POST', {
        projectId,
        conversationId,
        tabId: tab.id,
        title: entry.title || tab.title || '',
        url: entry.url
      });
      if (!response?.ok) throw new Error(response?.error || 'project-reattach-failed');
      if (fallback && entry.conversationId !== conversationId) {
        await this.apiRequest('/projects/detach', 'POST', { conversationId: entry.conversationId, forget: true }).catch(() => {});
      }
    }
  }

  function selectEntries(snapshot, options) {
    const entryIds = Array.isArray(options.entryIds) ? new Set(options.entryIds.map(String)) : null;
    const conversationIds = Array.isArray(options.conversationIds) ? new Set(options.conversationIds.map(String)) : null;
    const ids = new Set();
    for (const group of snapshot.groups || []) {
      for (const entry of group.tabs || []) {
        const include = (!entryIds && !conversationIds) || entryIds?.has(entry.entryId) || conversationIds?.has(entry.conversationId);
        if (include) ids.add(entry.entryId);
      }
    }
    return { ids, total: ids.size };
  }

  function buildUrlPools(tabs) {
    const pools = new Map();
    for (const tab of tabs || []) {
      const url = normalizeRestorableUrl(tab?.url);
      if (!url || !Number.isInteger(tab?.id)) continue;
      if (!pools.has(url)) pools.set(url, []);
      pools.get(url).push(tab);
    }
    return pools;
  }

  function preferredWindowForEntries(entries, pools, usedTabIds) {
    for (const entry of entries) {
      for (const tab of pools.get(entry.url) || []) {
        if (!usedTabIds.has(tab.id) && Number.isInteger(tab.windowId)) return tab.windowId;
      }
    }
    return null;
  }

  function takeExistingTab(pools, url, usedTabIds, preferredWindowId) {
    const rows = pools.get(url) || [];
    let index = -1;
    if (Number.isInteger(preferredWindowId)) {
      index = rows.findIndex(tab => !usedTabIds.has(tab.id) && tab.windowId === preferredWindowId);
    } else {
      index = rows.findIndex(tab => !usedTabIds.has(tab.id));
    }
    if (index < 0) return null;
    return rows.splice(index, 1)[0];
  }

  function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

  root.ChatSentinelSessionRestore = Object.freeze({ SessionRestoreController });
})(globalThis);