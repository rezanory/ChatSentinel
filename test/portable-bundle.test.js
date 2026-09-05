import test from 'node:test';
import assert from 'node:assert/strict';
import { applyPortableImport, createPortableBundle, previewPortableImport, validatePortableBundle } from '../src/portable-bundle.js';

function memoryStore() {
  const projects = { 'project:a': { projectId: 'project:a', name: 'Alpha', projectPath: 'C:\\Alpha', color: 'blue' } };
  const configs = { 'chat:1': { projectId: 'project:a', title: 'Alpha chat', url: 'https://chatgpt.com/c/1' } };
  const sessions = { 'chat:1': { state: 'STALLED', decision: { action: 'RELOAD' }, sideEffectRisk: 'low', checkpointFresh: true } };
  return {
    projects, configs, sessions,
    getProject: id => projects[id] || null,
    getConfig: id => configs[id] || {},
    getSession: id => sessions[id] || {},
    setProject: async (id, value) => { projects[id] = value; },
    setConfig: async (id, value) => { configs[id] = value; },
    setSession: (id, value) => { sessions[id] = value; },
    flush: async () => {}
  };
}

test('export is scoped and excludes unrelated data', () => {
  const store = memoryStore();
  store.projects['project:b'] = { projectId: 'project:b', name: 'Beta', projectPath: 'C:\\Beta' };
  const bundle = createPortableBundle(store, { projectIds: ['project:a'] });
  assert.equal(bundle.projects.length, 1);
  assert.equal(bundle.projects[0].projectId, 'project:a');
  assert.deepEqual(Object.keys(bundle.configs), ['chat:1']);
  assert.equal(bundle.recoverySnapshots['chat:1'].state, 'STALLED');
});

test('preview detects conflicts and apply requires exact preview token', async () => {
  const store = memoryStore();
  const bundle = createPortableBundle(store);
  bundle.projects[0].projectPath = 'D:\\MovedAlpha';
  const preview = previewPortableImport(store, bundle);
  assert.equal(preview.ok, true);
  assert.equal(preview.preview.conflicts[0].type, 'project-path-change');
  assert.equal((await applyPortableImport(store, bundle, {})).error, 'preview-token-required');
  const applied = await applyPortableImport(store, bundle, { previewToken: preview.previewToken, applyRecoverySnapshots: true });
  assert.equal(applied.ok, true);
  assert.equal(store.projects['project:a'].projectPath, 'D:\\MovedAlpha');
  assert.ok(store.sessions['chat:1'].importedAt);
});
