import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { StateStore } from '../src/state-store.js';

async function tempStore(options = {}) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'chatsentinel-state-'));
  const file = path.join(dir, 'state.json');
  const store = new StateStore({ file, ...options });
  await store.load();
  return { dir, file, store };
}

test('state store persists configs and sessions across restart', async t => {
  const { dir, file, store } = await tempStore();
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  await store.setConfig('chat-1', { projectPath: 'C:\\Project', operationClass: 'write' });
  store.setSession('chat-1', { updatedAt: new Date().toISOString(), decision: { action: 'WAIT' } });
  await store.flush();

  const restored = new StateStore({ file });
  await restored.load();
  assert.equal(restored.getConfig('chat-1').operationClass, 'write');
  assert.equal(restored.getSession('chat-1').decision.action, 'WAIT');
});

test('state store quarantines corrupt data instead of crashing', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'chatsentinel-corrupt-'));
  const file = path.join(dir, 'state.json');
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  await fs.writeFile(file, '{broken', 'utf8');
  const errors = [];
  const store = new StateStore({ file, onError: error => errors.push(error) });
  await store.load();
  assert.equal(Object.keys(store.configs).length, 0);
  assert.equal(errors.length, 1);
  const files = await fs.readdir(dir);
  assert.ok(files.some(name => name.startsWith('state.json.corrupt-')));
});

test('state store prunes stale and excess sessions', async t => {
  const { dir, store } = await tempStore({ maxSessions: 2, sessionTtlMs: 60_000 });
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const now = Date.now();
  store.state.sessions = {
    stale: { updatedAt: new Date(now - 120_000).toISOString() },
    a: { updatedAt: new Date(now - 3_000).toISOString() },
    b: { updatedAt: new Date(now - 2_000).toISOString() },
    c: { updatedAt: new Date(now - 1_000).toISOString() }
  };
  store.prune(now);
  assert.deepEqual(Object.keys(store.sessions).sort(), ['b', 'c']);
});

test('v1 single-project configs migrate into v1.1 project registry', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'chatsentinel-migrate-'));
  const file = path.join(dir, 'state.json');
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  await fs.writeFile(file, JSON.stringify({
    schemaVersion: 1,
    configs: {
      a: { projectPath: 'C:\\LegacyProject', operationClass: 'write' },
      b: { projectPath: 'C:\\LegacyProject', operationClass: 'write' }
    },
    sessions: {},
    meta: {}
  }), 'utf8');
  const store = new StateStore({ file });
  await store.load();
  assert.equal(store.state.schemaVersion, 3);
  assert.equal(Object.keys(store.projects).length, 1);
  const project = Object.values(store.projects)[0];
  assert.equal(project.name, 'LegacyProject');
  assert.equal(project.migratedFromV1, true);
  assert.equal(store.getConfig('a').projectId, project.projectId);
  assert.equal(store.getConfig('b').projectId, project.projectId);
});

test('state store recovers its save queue after a transient prior failure', async t => {
  const { dir, file, store } = await tempStore();
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const transient = Object.assign(new Error('transient state replace failure'), { code: 'EBUSY' });
  store.saving = Promise.reject(transient);
  await store.setProject('project:recovered', { projectId: 'project:recovered', name: 'Recovered' });

  const restored = new StateStore({ file });
  await restored.load();
  assert.equal(restored.getProject('project:recovered').name, 'Recovered');
});
