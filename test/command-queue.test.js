import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { StateStore } from '../src/state-store.js';
import { claimCommand, completeCommand, enqueueCommand, listCommands, updateCommandProgress } from '../src/command-queue.js';

async function makeStore() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'chatsentinel-command-'));
  const file = path.join(dir, 'state.json');
  const store = new StateStore({ file });
  await store.load();
  return { dir, file, store };
}

test('command queue persists and deduplicates by idempotency key', async t => {
  const { dir, file, store } = await makeStore();
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const input = { type: 'GROUP_PROJECT_TABS', payload: { projectId: 'p1' }, idempotencyKey: 'group:p1' };
  const first = await enqueueCommand(store, input);
  const second = await enqueueCommand(store, input);
  assert.equal(first.command.commandId, second.command.commandId);
  assert.equal(second.deduplicated, true);
  const restored = new StateStore({ file });
  await restored.load();
  assert.equal(Object.keys(restored.commands).length, 1);
});

test('failed or cancelled idempotency key remains terminally deduplicated within retention', async t => {
  const { dir, store } = await makeStore();
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const input = { type: 'GROUP_PROJECT_TABS', payload: { projectId: 'p1' }, idempotencyKey: 'terminal:p1' };
  const first = await enqueueCommand(store, input);
  const claimed = await claimCommand(store, { workerId: 'worker-a', leaseMs: 5000 });
  await completeCommand(store, { commandId: claimed.commandId, outcome: 'failed', error: 'target-tab-not-found' });
  const second = await enqueueCommand(store, input);
  assert.equal(second.deduplicated, true);
  assert.equal(second.command.commandId, first.command.commandId);
  assert.equal(second.command.status, 'failed');
});

test('command lease/progress/retry lifecycle is resumable', async t => {
  const { dir, store } = await makeStore();
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const queued = await enqueueCommand(store, {
    type: 'CREATE_LANE_CHAT',
    payload: { projectId: 'p1', prompt: 'seed' },
    maxAttempts: 3
  });
  let claimed = await claimCommand(store, { workerId: 'worker-a', leaseMs: 5000 });
  assert.equal(claimed.commandId, queued.command.commandId);
  assert.equal(claimed.status, 'running');
  assert.equal(claimed.attempts, 1);

  await updateCommandProgress(store, {
    commandId: claimed.commandId,
    workerId: 'worker-a',
    leaseMs: 5000,
    progress: { tabId: 42, attached: true }
  });
  await completeCommand(store, {
    commandId: claimed.commandId,
    outcome: 'retry',
    error: 'composer-not-ready',
    retryAfterMs: 1
  });
  await new Promise(resolve => setTimeout(resolve, 5));
  claimed = await claimCommand(store, { workerId: 'worker-b', leaseMs: 5000 });
  assert.equal(claimed.attempts, 2);
  assert.equal(claimed.progress.tabId, 42);
  assert.equal(claimed.progress.attached, true);
  await completeCommand(store, { commandId: claimed.commandId, outcome: 'succeeded', result: { tabId: 42 } });
  const rows = listCommands(store);
  assert.equal(rows[0].status, 'succeeded');
  assert.equal(rows[0].result.tabId, 42);
});

test('claim can skip rate-sensitive commands without consuming their attempts', async t => {
  const { dir, store } = await makeStore();
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const blocked = await enqueueCommand(store, {
    type: 'CREATE_LANE_CHAT',
    payload: { projectId: 'p1', prompt: 'rate-sensitive' }
  });
  const local = await enqueueCommand(store, {
    type: 'GROUP_PROJECT_TABS',
    payload: { projectId: 'p1' }
  });
  const claimed = await claimCommand(store, {
    workerId: 'worker-a',
    leaseMs: 5000,
    excludeTypes: ['CREATE_LANE_CHAT', 'SEND_PROMPT', 'RELOAD_CHAT', 'REPLACE_CHAT']
  });
  assert.equal(claimed.commandId, local.command.commandId);
  assert.equal(store.commands[blocked.command.commandId].attempts, 0);
  assert.equal(store.commands[blocked.command.commandId].status, 'pending');
});

test('retry budget exhaustion is terminally quarantined instead of looping', async t => {
  const { dir, store } = await makeStore();
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const queued = await enqueueCommand(store, {
    type: 'SEND_PROMPT',
    payload: { conversationId: 'chat:1', prompt: 'fix' },
    maxAttempts: 1
  });
  const claimed = await claimCommand(store, { workerId: 'worker-a', leaseMs: 5000 });
  assert.equal(claimed.commandId, queued.command.commandId);
  const completed = await completeCommand(store, {
    commandId: claimed.commandId,
    outcome: 'retry',
    error: 'still-broken',
    retryAfterMs: 1
  });
  assert.equal(completed.status, 'failed');
  assert.equal(completed.quarantined, true);
  assert.equal(completed.retryExhausted, true);
  assert.equal(completed.terminalReason, 'retry-budget-exhausted');
  assert.equal(await claimCommand(store, { workerId: 'worker-b', leaseMs: 5000 }), null);
});

test('expired running command at max attempts is quarantined before another claim', async t => {
  const { dir, store } = await makeStore();
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const queued = await enqueueCommand(store, {
    type: 'SEND_PROMPT',
    payload: { conversationId: 'chat:2', prompt: 'fix' },
    maxAttempts: 1
  });
  store.commands[queued.command.commandId].status = 'running';
  store.commands[queued.command.commandId].attempts = 1;
  store.commands[queued.command.commandId].leaseUntil = new Date(Date.now() - 1000).toISOString();
  const next = await claimCommand(store, { workerId: 'worker-b', leaseMs: 5000 });
  assert.equal(next, null);
  const exhausted = store.commands[queued.command.commandId];
  assert.equal(exhausted.status, 'failed');
  assert.equal(exhausted.quarantined, true);
  assert.equal(exhausted.terminalReason, 'retry-budget-exhausted');
});