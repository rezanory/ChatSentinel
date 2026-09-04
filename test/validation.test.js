import test from 'node:test';
import assert from 'node:assert/strict';
import { validateConversationConfig, validateReconcileRequest, validateSignal } from '../src/validation.js';

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
