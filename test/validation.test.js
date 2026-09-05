import test from 'node:test';
import assert from 'node:assert/strict';
import { validateCommandClaim, validateCommandComplete, validateCommandEnqueue, validateConversationConfig, validateProject, validateProjectAttach, validateReconcileRequest, validateSignal } from '../src/validation.js';

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
    retryVisible: 1,
    messageDeliveryTimedOut: 1,
    messageDeliveryRetryCount: 99
  });
  assert.equal(result.ok, true);
  assert.equal(result.value.state, 'RUNNING');
  assert.equal(result.value.progressAgeMs, 0);
  assert.equal(result.value.retryVisible, true);
  assert.equal(result.value.messageDeliveryTimedOut, true);
  assert.equal(result.value.messageDeliveryRetryCount, 10);
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

test('supervisor command validation accepts safe lane creation and rejects unsafe URLs', () => {
  const good = validateCommandEnqueue({
    type: 'CREATE_LANE_CHAT',
    payload: { projectId: 'p1', prompt: 'seed', laneId: 'C1', branch: 'feat/c1' }
  });
  assert.equal(good.ok, true);
  const bad = validateCommandEnqueue({
    type: 'CREATE_LANE_CHAT',
    payload: { projectId: 'p1', prompt: 'seed', url: 'https://example.com/' }
  });
  assert.equal(bad.ok, false);
  assert.equal(bad.error, 'command-url-invalid');
});

test('command claim and completion schemas are bounded', () => {
  assert.equal(validateCommandClaim({ workerId: 'extension:test', leaseMs: 60000 }).ok, true);
  assert.equal(validateCommandClaim({}).ok, false);
  assert.equal(validateCommandComplete({ commandId: 'cmd:1', outcome: 'succeeded' }).ok, true);
  assert.equal(validateCommandComplete({ commandId: 'cmd:1', outcome: 'unknown' }).ok, false);
});

test('lane baseline evidence survives command and project-attach validation', () => {
  const baselineSha = 'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee';
  const command = validateCommandEnqueue({
    type: 'CREATE_LANE_CHAT',
    payload: { projectId: 'p1', prompt: 'seed', laneId: 'C1', branch: 'feat/c1', baselineSha }
  });
  assert.equal(command.ok, true);
  assert.equal(command.value.payload.baselineSha, baselineSha);
  const attach = validateProjectAttach({
    projectId: 'p1', conversationId: 'chat:1', laneId: 'C1', branch: 'feat/c1', baselineSha
  });
  assert.equal(attach.ok, true);
  assert.equal(attach.value.baselineSha, baselineSha);
});
