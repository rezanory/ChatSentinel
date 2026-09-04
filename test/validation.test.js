import test from 'node:test';
import assert from 'node:assert/strict';
import { validateConversationConfig, validateProject, validateProjectAttach, validateReconcileRequest, validateSignal } from '../src/validation.js';

test('conversation config rejects unknown operation classes', () => {
  const result = validateConversationConfig({ conversationId: 'x', operationClass: 'dangerous_magic' });
  assert.equal(result.ok, false);
  assert.equal(result.error, 'operationClass-invalid');
});

test('signal normalizes numeric and boolean fields', () => {
  const result = validateSignal({
    conversationId: 'chat',
    state: 'running',
    progressAgeMs: -10,
    retryVisible: 1
  });
  assert.equal(result.ok, true);
  assert.equal(result.value.state, 'RUNNING');
  assert.equal(result.value.progressAgeMs, 0);
  assert.equal(result.value.retryVisible, true);
});

test('reconcile requires project or conversation reference', () => {
  assert.equal(validateReconcileRequest({}).ok, false);
  assert.equal(validateReconcileRequest({ conversationId: 'chat' }).ok, true);
});

test('project validation accepts multi-chat settings and rejects invalid color', () => {
  const valid = validateProject({
    name: 'Alpha', projectPath: 'C:\\Alpha', operationClass: 'write',
    autoRecovery: true, groupTabs: true, color: 'purple'
  });
  assert.equal(valid.ok, true);
  assert.equal(valid.value.autoRecovery, true);
  assert.equal(valid.value.groupTabs, true);
  assert.equal(valid.value.color, 'purple');
  assert.equal(validateProject({ name: 'Alpha', projectPath: 'C:\\Alpha', color: 'chartreuse' }).ok, false);
});

test('project attach requires both project and conversation identities', () => {
  assert.equal(validateProjectAttach({ projectId: 'project:a', conversationId: 'chat:a', tabId: 10 }).ok, true);
  assert.equal(validateProjectAttach({ projectId: 'project:a' }).ok, false);
  assert.equal(validateProjectAttach({ conversationId: 'chat:a' }).ok, false);
});