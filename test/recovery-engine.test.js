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

test('interrupted stream with known checkpoint continues same chat', () => {
  assert.equal(decideRecovery({ connectionInterrupted: true, checkpointFresh: true }).action, Action.CONTINUE_SAME_CHAT);
});
