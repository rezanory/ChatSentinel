import test from 'node:test';
import assert from 'node:assert/strict';

await import('../extension/session-snapshot-store.js');
await import('../extension/session-restore-controller.js');
const { SessionSnapshotStore } = globalThis.ChatSentinelSessionSnapshots;
const { SessionRestoreController } = globalThis.ChatSentinelSessionRestore;

class FakeStorage {
  constructor() { this.data = {}; }
  async get(key) { return { [key]: structuredClone(this.data[key]) }; }
  async set(values) { Object.assign(this.data, structuredClone(values)); }
  async remove(key) { delete this.data[key]; }
}

function createFakeChrome({ tabs = [], groups = [], failCreateUrls = [], failGroupUpdates = 0, lastFocusedWindowId = 1 } = {}) {
  const storage = new FakeStorage();
  const tabMap = new Map(tabs.map(tab => [tab.id, { groupId: -1, pinned: false, active: false, index: 0, ...structuredClone(tab) }]));
  const groupMap = new Map(groups.map(group => [group.id, structuredClone(group)]));
  let nextTabId = Math.max(100, ...tabMap.keys()) + 1;
  let nextGroupId = Math.max(500, ...groupMap.keys()) + 1;
  let remainingGroupFailures = failGroupUpdates;
  const focusCalls = [];
  const createCalls = [];
  const groupCalls = [];

  const chromeApi = {
    storage: { local: storage },
    tabs: {
      async get(id) {
        if (!tabMap.has(id)) throw new Error('tab-not-found');
        return structuredClone(tabMap.get(id));
      },
      async query() { return [...tabMap.values()].map(tab => structuredClone(tab)); },
      async create(options) {
        if (failCreateUrls.includes(options.url)) throw new Error('injected-create-failure');
        const id = nextTabId++;
        const windowId = Number.isInteger(options.windowId) ? options.windowId : lastFocusedWindowId;
        const index = [...tabMap.values()].filter(tab => tab.windowId === windowId).length;
        const tab = { id, windowId, index, groupId: -1, title: '', active: Boolean(options.active), pinned: Boolean(options.pinned), url: options.url };
        tabMap.set(id, tab);
        createCalls.push(structuredClone(options));
        return structuredClone(tab);
      },
      async update(id, changes) {
        const tab = tabMap.get(id);
        if (!tab) throw new Error('tab-not-found');
        if (changes.active) {
          for (const row of tabMap.values()) if (row.windowId === tab.windowId) row.active = false;
        }
        Object.assign(tab, changes);
        return structuredClone(tab);
      },
      async group({ tabIds, createProperties }) {
        const groupId = nextGroupId++;
        const windowId = createProperties?.windowId ?? tabMap.get(tabIds[0])?.windowId ?? lastFocusedWindowId;
        for (const id of tabIds) {
          const tab = tabMap.get(id);
          if (!tab) throw new Error('group-tab-not-found');
          tab.windowId = windowId;
          tab.groupId = groupId;
        }
        groupMap.set(groupId, { id: groupId, windowId, title: '', color: 'grey', collapsed: false });
        groupCalls.push({ groupId, tabIds: [...tabIds], windowId });
        return groupId;
      }
    },
    tabGroups: {
      async get(id) {
        if (!groupMap.has(id)) throw new Error('group-not-found');
        return structuredClone(groupMap.get(id));
      },
      async update(id, changes) {
        if (remainingGroupFailures > 0) {
          remainingGroupFailures -= 1;
          throw new Error('injected-group-update-failure');
        }
        const group = groupMap.get(id);
        if (!group) throw new Error('group-not-found');
        Object.assign(group, changes);
        return structuredClone(group);
      }
    },
    windows: {
      async getLastFocused() { return { id: lastFocusedWindowId }; },
      async update(id, changes) { focusCalls.push({ id, ...changes }); return { id, ...changes }; }
    }
  };

  return { chromeApi, storage, tabMap, groupMap, focusCalls, createCalls, groupCalls };
}

function makeStore(storage, now = 1_000_000) {
  let id = 0;
  return new SessionSnapshotStore({ storage, clock: () => now + id * 10, idFactory: () => `id-${++id}` });
}

async function saveSnapshot(store, projectId = 'p1') {
  return store.saveProjectSnapshot({
    project: { projectId, name: 'Alpha', color: 'purple', groupTabs: true },
    reason: 'fixture',
    groups: [{
      groupKey: 'g1', title: 'Alpha', color: 'purple', collapsed: true, windowOrdinal: 0,
      tabs: [
        { entryId: 'e1', conversationId: 'conv-1', url: 'https://chatgpt.com/c/one', title: 'One', index: 0 },
        { entryId: 'e2', conversationId: 'conv-2', url: 'https://chatgpt.com/c/two', title: 'Two', index: 1 }
      ]
    }]
  });
}

test('capture persists project group metadata and recoverable stale chat URLs', async () => {
  const fake = createFakeChrome({
    tabs: [{ id: 11, windowId: 3, groupId: 41, url: 'https://chatgpt.com/c/live', title: 'Live', index: 2, active: true }],
    groups: [{ id: 41, windowId: 3, title: 'Alpha lanes', color: 'cyan', collapsed: true }]
  });
  const store = makeStore(fake.storage);
  const project = {
    projectId: 'p1', name: 'Alpha', color: 'purple', groupTabs: true,
    chats: [
      { conversationId: 'conv-live', tabId: 11, url: 'https://chatgpt.com/c/live', title: 'old live title' },
      { conversationId: 'conv-stale', tabId: 99, url: 'https://chatgpt.com/c/stale', title: 'Stale but durable' }
    ]
  };
  const controller = new SessionRestoreController({ chromeApi: fake.chromeApi, snapshotStore: store, apiRequest: async () => ({ ok: true }), startupSettleMs: 0 });
  const snapshot = await controller.captureProject(project, 'group-change');

  assert.equal(snapshot.tabCount, 2);
  assert.equal(snapshot.groups.length, 2);
  const liveGroup = snapshot.groups.find(group => group.tabs.some(tab => tab.conversationId === 'conv-live'));
  assert.equal(liveGroup.title, 'Alpha lanes');
  assert.equal(liveGroup.color, 'cyan');
  assert.equal(liveGroup.collapsed, true);
  assert.ok(snapshot.groups.some(group => group.tabs.some(tab => tab.url === 'https://chatgpt.com/c/stale')));
});

test('selective restore restores only requested entries and reattaches membership', async () => {
  const fake = createFakeChrome();
  const store = makeStore(fake.storage);
  const snapshot = await saveSnapshot(store);
  const calls = [];
  const controller = new SessionRestoreController({
    chromeApi: fake.chromeApi,
    snapshotStore: store,
    apiRequest: async (route, method, body) => { calls.push({ route, method, body }); return { ok: true }; },
    startupSettleMs: 0
  });

  const result = await controller.restoreSnapshot(snapshot.snapshotId, { entryIds: ['e2'], activate: true });
  assert.equal(result.ok, true);
  assert.equal(result.restored, 1);
  assert.equal(result.created, 1);
  assert.equal(fake.createCalls[0].url, 'https://chatgpt.com/c/two');
  assert.equal(fake.groupCalls.length, 1);
  assert.equal(fake.groupMap.get(fake.groupCalls[0].groupId).title, 'Alpha');
  assert.equal(fake.focusCalls.length, 1);
  assert.ok(calls.some(call => call.route === '/projects/attach' && call.body.conversationId === 'conv-2'));
});

test('browser restart restore reuses native-restored tabs, creates only missing tabs, and tolerates attach failure', async () => {
  const fake = createFakeChrome({
    tabs: [{ id: 20, windowId: 7, url: 'https://chatgpt.com/c/one', title: 'One native', index: 0, active: false }],
    lastFocusedWindowId: 1
  });
  const store = makeStore(fake.storage);
  await saveSnapshot(store);
  let attachCount = 0;
  const controller = new SessionRestoreController({
    chromeApi: fake.chromeApi,
    snapshotStore: store,
    apiRequest: async route => {
      if (route === '/projects/attach' && ++attachCount === 2) return { ok: false, error: 'watchdog-temporarily-down' };
      return { ok: true };
    },
    startupSettleMs: 0
  });

  const result = await controller.restoreAfterBrowserRestart();
  assert.equal(result.ok, true);
  const restore = result.results[0];
  assert.equal(restore.reused, 1);
  assert.equal(restore.created, 1);
  assert.equal(restore.restored, 2);
  assert.equal(restore.attachFailures.length, 1);
  assert.equal(fake.createCalls[0].windowId, 7);
  assert.equal(fake.groupCalls[0].windowId, 7);
  assert.equal(fake.focusCalls.length, 0);
});

test('group restore failure is collected and does not stop later groups', async () => {
  const fake = createFakeChrome({ failGroupUpdates: 1 });
  const store = makeStore(fake.storage);
  const snapshot = await store.saveProjectSnapshot({
    project: { projectId: 'p1', name: 'Alpha', color: 'blue', groupTabs: true },
    groups: [
      { groupKey: 'g1', title: 'Alpha 1', tabs: [{ entryId: 'a', conversationId: 'a', url: 'https://chatgpt.com/c/a' }] },
      { groupKey: 'g2', title: 'Alpha 2', tabs: [{ entryId: 'b', conversationId: 'b', url: 'https://chatgpt.com/c/b' }] }
    ]
  });
  const controller = new SessionRestoreController({ chromeApi: fake.chromeApi, snapshotStore: store, apiRequest: async () => ({ ok: true }), startupSettleMs: 0 });

  const result = await controller.restoreSnapshot(snapshot.snapshotId, { activate: false });
  assert.equal(result.ok, false);
  assert.equal(result.restored, 2);
  assert.equal(result.failures.filter(row => row.phase === 'group-restore').length, 1);
  assert.equal(fake.groupCalls.length, 2);
  const successfulGroup = [...fake.groupMap.values()].find(group => group.title === 'Alpha 2');
  assert.ok(successfulGroup);
});

test('project switching restores latest snapshot and focuses the project tab', async () => {
  const fake = createFakeChrome({ tabs: [{ id: 31, windowId: 4, url: 'https://chatgpt.com/c/one', title: 'One', index: 0 }] });
  const store = makeStore(fake.storage);
  await saveSnapshot(store, 'p-switch');
  const controller = new SessionRestoreController({ chromeApi: fake.chromeApi, snapshotStore: store, apiRequest: async () => ({ ok: true }), startupSettleMs: 0 });

  const result = await controller.switchProject('p-switch');
  assert.equal(result.ok, true);
  assert.equal(result.projectId, 'p-switch');
  assert.equal(result.reused, 1);
  assert.equal(result.created, 1);
  assert.equal(fake.focusCalls.at(-1).id, 4);
  assert.equal(fake.tabMap.get(31).active, true);
});

test('tab create failure is isolated so remaining selected tabs still restore', async () => {
  const fake = createFakeChrome({ failCreateUrls: ['https://chatgpt.com/c/one'] });
  const store = makeStore(fake.storage);
  const snapshot = await saveSnapshot(store);
  const controller = new SessionRestoreController({ chromeApi: fake.chromeApi, snapshotStore: store, apiRequest: async () => ({ ok: true }), startupSettleMs: 0 });

  const result = await controller.restoreSnapshot(snapshot.snapshotId, { activate: false });
  assert.equal(result.ok, false);
  assert.equal(result.restored, 1);
  assert.equal(result.failures.filter(row => row.phase === 'tab-restore').length, 1);
  assert.ok([...fake.tabMap.values()].some(tab => tab.url === 'https://chatgpt.com/c/two'));
});