import test from 'node:test';
import assert from 'node:assert/strict';
import { Action, decideRecovery } from '../src/recovery-engine.js';

test('running work is never interrupted', () => {
  assert.equal(decideRecovery({ state: 'RUNNING', retryVisible: true }).action, Action.WAIT);
});

test('retry is allowed only when side effects are known absent', () => {
  assert.equal(decideRecovery({ retryVisible: true, sideEffectRisk: 'none' }).action, Action.SAFE_RETRY);
});

test('unknown retry state escalates instead of blind retry', () => {
  assert.equal(decideRecovery({ retryVisible: true, sideEffectRisk: 'unknown' }).action, Action.ESCALATE);
});

test('retry with fresh checkpoint continues rather than repeats', () => {
  assert.equal(decideRecovery({ retryVisible: true, checkpointFresh: true, sideEffectRisk: 'possible' }).action, Action.CONTINUE_SAME_CHAT);
});

test('dead conversation moves to a new chat', () => {
  assert.equal(decideRecovery({ conversationDead: true }).action, Action.CONTINUE_NEW_CHAT);
});

test('frozen UI reloads and rechecks', () => {
  assert.equal(decideRecovery({ uiFrozen: true, progressAgeMs: 180000 }).action, Action.RELOAD_AND_RECHECK);
});

test('interrupted stream with known checkpoint continues same chat to complete the answer', () => {
  const result = decideRecovery({ connectionInterrupted: true, checkpointFresh: true });
  assert.equal(result.action, Action.CONTINUE_SAME_CHAT);
  assert.match(result.reason, /complete-answer-checkpoint-known/);
});

test('interrupted stream without a fresh checkpoint reconciles in the same chat instead of reload-looping', () => {
  const result = decideRecovery({ connectionInterrupted: true, checkpointFresh: false });
  assert.equal(result.action, Action.CONTINUE_SAME_CHAT);
  assert.match(result.reason, /complete-answer-reconcile-required/);
});

test('active interruption takes precedence over stale-ui reload when generation already stopped', () => {
  const result = decideRecovery({ connectionInterrupted: true, uiFrozen: true, progressAgeMs: 300000 });
  assert.equal(result.action, Action.CONTINUE_SAME_CHAT);
});

test('message delivery timeout uses the native delivery retry independently of generic retry risk', () => {
  const result = decideRecovery({
    messageDeliveryTimedOut: true,
    messageDeliveryRetryCount: 0,
    retryVisible: true,
    sideEffectRisk: 'possible'
  });
  assert.equal(result.action, Action.RETRY_MESSAGE_DELIVERY);
  assert.equal(result.reason, 'message-delivery-timeout-native-retry');
});

test('message delivery timeout stops after the bounded native retry budget', () => {
  const result = decideRecovery({
    messageDeliveryTimedOut: true,
    messageDeliveryRetryCount: 2,
    retryVisible: true
  });
  assert.equal(result.action, Action.ESCALATE);
  assert.equal(result.reason, 'message-delivery-timeout-retry-budget-exhausted');
});
