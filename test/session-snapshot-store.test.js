import test from 'node:test';
import assert from 'node:assert/strict';

await import('../extension/session-snapshot-store.js');
const { SessionSnapshotStore, normalizeRestorableUrl } = globalThis.ChatSentinelSessionSnapshots;

class FakeStorage {
  constructor(initial = {}) {
    this.data = structuredClone(initial);
    this.failGet = false;
    this.failSet = false;
    this.setCalls = 0;
  }

  async get(key) {
    if (this.failGet) throw new Error('injected-get-failure');
    return { [key]: structuredClone(this.data[key]) };
  }

  async set(values) {
    if (this.failSet) {
      this.failSet = false;
      throw new Error('injected-set-failure');
    }
    this.setCalls += 1;
    for (const [key, value] of Object.entries(values)) this.data[key] = structuredClone(value);
  }
}

function snapshotInput(projectId, suffix = 'a') {
  return {
    project: { projectId, name: `Project ${projectId}`, color: 'purple', groupTabs: true },
    groups: [{
      groupKey: 'window:1',
      title: `Project ${projectId}`,
      color: 'purple',
      collapsed: false,
      windowOrdinal: 0,
      tabs: [
        { entryId: `${projectId}:${suffix}`, conversationId: `${projectId}:${suffix}`, url: `https://chatgpt.com/c/${suffix}`, title: suffix },
        { entryId: 'unsafe', conversationId: 'unsafe', url: 'https://example.com/steal', title: 'unsafe' }
      ]
    }],
    reason: 'test'
  };
}

test('snapshot store normalizes safe tabs and de-duplicates unchanged content', async () => {
  let now = 10_000;
  let id = 0;
  const storage = new FakeStorage();
  const store = new SessionSnapshotStore({ storage, clock: () => now, idFactory: () => `id-${++id}` });

  const first = await store.saveProjectSnapshot(snapshotInput('p1', 'alpha'));
  assert.equal(first.tabCount, 1);
  assert.equal(first.groups[0].tabs[0].url, 'https://chatgpt.com/c/alpha');
  now += 500;
  const duplicate = await store.saveProjectSnapshot(snapshotInput('p1', 'alpha'));
  assert.equal(duplicate.snapshotId, first.snapshotId);
  assert.equal((await store.list('p1')).length, 1);
  assert.equal(storage.setCalls, 1);
});

test('retention is per project and TTL pruning persists', async () => {
  let now = 100_000;
  let id = 0;
  const storage = new FakeStorage();
  const store = new SessionSnapshotStore({
    storage,
    maxPerProject: 2,
    ttlMs: 1_000,
    clock: () => now,
    idFactory: () => `id-${++id}`
  });

  await store.saveProjectSnapshot(snapshotInput('p1', 'one'));
  now += 10;
  await store.saveProjectSnapshot(snapshotInput('p1', 'two'));
  now += 10;
  await store.saveProjectSnapshot(snapshotInput('p1', 'three'));
  await store.saveProjectSnapshot(snapshotInput('p2', 'other'));

  assert.deepEqual((await store.list('p1')).map(row => row.groups[0].tabs[0].title), ['three', 'two']);
  assert.equal((await store.list('p2')).length, 1);

  now += 2_000;
  assert.equal((await store.list()).length, 0);
  assert.equal(storage.data['sessionSnapshots:v1'].snapshots.length, 0);
});

test('write failure does not replace the previously persisted snapshot', async () => {
  let now = 200_000;
  let id = 0;
  const storage = new FakeStorage();
  const store = new SessionSnapshotStore({ storage, clock: () => now, idFactory: () => `id-${++id}` });
  const baseline = await store.saveProjectSnapshot(snapshotInput('p1', 'baseline'));

  now += 10;
  storage.failSet = true;
  await assert.rejects(store.saveProjectSnapshot(snapshotInput('p1', 'failed')), /injected-set-failure/);
  const afterFailure = await store.latest('p1');
  assert.equal(afterFailure.snapshotId, baseline.snapshotId);
  assert.equal(afterFailure.groups[0].tabs[0].title, 'baseline');

  now += 10;
  const recovered = await store.saveProjectSnapshot(snapshotInput('p1', 'recovered'));
  assert.notEqual(recovered.snapshotId, baseline.snapshotId);
  assert.equal((await store.latest('p1')).groups[0].tabs[0].title, 'recovered');
});

test('corrupt persisted rows are quarantined logically instead of blocking new snapshots', async () => {
  const storage = new FakeStorage({
    'sessionSnapshots:v1': { schemaVersion: 99, snapshots: [{ snapshotId: '', projectId: 'bad', createdAt: 'broken' }] }
  });
  const store = new SessionSnapshotStore({ storage, clock: () => 300_000, idFactory: () => 'fixed' });
  const saved = await store.saveProjectSnapshot(snapshotInput('p1', 'valid'));
  const rows = await store.list();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].snapshotId, saved.snapshotId);
});

test('restorable URL policy permits ChatGPT and local fixtures only', () => {
  assert.equal(normalizeRestorableUrl('https://chatgpt.com/c/123#frag'), 'https://chatgpt.com/c/123');
  assert.equal(normalizeRestorableUrl('http://127.0.0.1:4320/idle'), 'http://127.0.0.1:4320/idle');
  assert.equal(normalizeRestorableUrl('https://example.org/'), '');
  assert.equal(normalizeRestorableUrl('javascript:alert(1)'), '');
});