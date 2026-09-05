import test from 'node:test';
import assert from 'node:assert/strict';
import { searchProjectChats } from '../src/project-search.js';

function storeFixture() {
  const projects = {
    'project:a': { projectId: 'project:a', name: 'Alpha', projectPath: 'C:\\Alpha' },
    'project:b': { projectId: 'project:b', name: 'Beta', projectPath: 'C:\\Beta' }
  };
  const configs = {
    'chat:1': { projectId: 'project:a', title: 'Deploy lane', operationClass: 'write', url: 'https://chatgpt.com/c/1' },
    'chat:2': { projectId: 'project:b', title: 'Research notes', operationClass: 'read_only', url: 'https://chatgpt.com/c/2' }
  };
  const sessions = {
    'chat:1': { state: 'STALLED', decision: { action: 'RELOAD', reason: 'no-progress' }, sideEffectRisk: 'high', checkpointFresh: false, updatedAt: '2026-09-05T00:00:00Z' },
    'chat:2': { state: 'RUNNING', decision: { action: 'WAIT' }, sideEffectRisk: 'low', checkpointFresh: true, updatedAt: '2026-09-05T01:00:00Z' }
  };
  return { projects, configs, getProject: id => projects[id], getSession: id => sessions[id] || {} };
}

test('search spans project and chat metadata', () => {
  const result = searchProjectChats(storeFixture(), { query: 'alpha' });
  assert.equal(result.ok, true);
  assert.deepEqual(result.results.map(row => row.conversationId), ['chat:1']);
});

test('search combines state, risk, checkpoint and project filters', () => {
  const result = searchProjectChats(storeFixture(), { projectId: 'project:b', state: 'RUNNING', risk: 'low', checkpointFresh: 'true' });
  assert.equal(result.count, 1);
  assert.equal(result.results[0].title, 'Research notes');
});

test('invalid state filter fails closed', () => {
  assert.deepEqual(searchProjectChats(storeFixture(), { state: 'BROKEN' }), { ok: false, error: 'state-filter-invalid' });
});
