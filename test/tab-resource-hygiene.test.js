import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(
  new URL('../extension/components/tab-resource-hygiene/controller.js', import.meta.url),
  'utf8'
);

function loadApi() {
  const sandbox = {};
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox);
  return sandbox.ChatSentinelTabResourceHygiene;
}

test('idle background worker tab becomes discardable but active/running tabs do not', () => {
  const api = loadApi();
  const now = 1_000_000;
  const tab = { id: 10, active: false, audible: false, discarded: false, lastAccessed: now - 11 * 60_000 };
  const chat = { role: 'worker', state: 'IDLE', decision: { action: 'WAIT' } };
  assert.equal(api.safeToDiscard({ tab, chat, now }).allowed, true);
  assert.equal(api.safeToDiscard({ tab: { ...tab, active: true }, chat, now }).allowed, false);
  assert.equal(api.safeToDiscard({ tab, chat: { ...chat, state: 'RUNNING' }, now }).allowed, false);
});

test('judge uses a shorter idle renderer-reset threshold and is never auto-closed as a completed worker', () => {
  const api = loadApi();
  const now = 2_000_000;
  const tab = { id: 11, active: false, audible: false, discarded: false, lastAccessed: now - 5 * 60_000 };
  const judge = { role: 'judge', state: 'IDLE', decision: { action: 'WAIT' } };
  const gate = api.safeToDiscard({ tab, chat: judge, now });
  assert.equal(gate.allowed, true);
  assert.equal(gate.reason, 'judge-idle-renderer-reset');
  assert.equal(api.shouldCloseCompletedWorker({ chat: judge, completion: { complete: true, head: 'abc' } }).allowed, false);
});

test('canonical completed non-judge worker is eligible for closure', () => {
  const api = loadApi();
  const result = api.shouldCloseCompletedWorker({
    chat: { role: 'worker' },
    completion: { complete: true, head: 'abc123' }
  });
  assert.equal(result.allowed, true);
  assert.equal(result.reason, 'canonical-worker-complete');
});
