import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(
  new URL('../extension/components/request-rate-limit/controller.js', import.meta.url),
  'utf8'
);

function loadApi() {
  const sandbox = { Date, setTimeout };
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox);
  return sandbox.ChatSentinelRequestRateLimit;
}

function rateModal() {
  let clicks = 0;
  const button = {
    innerText: 'Got it', disabled: false,
    click() { clicks += 1; },
    getAttribute() { return ''; }
  };
  const modal = {
    innerText: "Too many requests. You're making requests too quickly. We've temporarily limited access to your conversations to protect your data. Please wait a few minutes before trying again. Got it",
    querySelectorAll(selector) { return selector === 'button' ? [button] : []; }
  };
  const root = {
    body: { innerText: modal.innerText },
    querySelectorAll(selector) {
      if (selector.includes('[role="dialog"]')) return [modal];
      if (selector === 'button') return [button];
      return [];
    }
  };
  return { root, button, clicks: () => clicks };
}

function storage() {
  const values = new Map();
  return {
    values,
    async get(keys) {
      const list = Array.isArray(keys) ? keys : [keys];
      return Object.fromEntries(list.map(key => [key, values.get(key)]));
    },
    async set(row) { for (const [key, value] of Object.entries(row)) values.set(key, value); }
  };
}

test('too-many-requests modal is recognized and Got it is clicked once per visible incident', () => {
  const api = loadApi();
  const fixture = rateModal();
  const observed = api.inspect(fixture.root);
  assert.equal(observed.active, true);
  assert.equal(observed.dismissLabel, 'Got it');
  const first = api.dismiss(fixture.root, 1000);
  assert.equal(first.dismissed, true);
  assert.equal(fixture.clicks(), 1);
  const duplicate = api.dismiss(fixture.root, 2000);
  assert.equal(duplicate.dismissed, false);
  assert.equal(duplicate.deduplicated, true);
  assert.equal(fixture.clicks(), 1);
  const later = api.dismiss(fixture.root, 7000);
  assert.equal(later.dismissed, true);
  assert.equal(fixture.clicks(), 2);
});

test('non-rate-limit page is not dismissed', () => {
  const api = loadApi();
  const root = { body: { innerText: 'Normal ChatGPT conversation' }, querySelectorAll() { return []; } };
  const result = api.dismiss(root, 1000);
  assert.equal(result.active, false);
  assert.equal(result.dismissed, false);
});

test('adaptive pacing escalates cooldown, deduplicates one incident, and shrinks command batches', async () => {
  const api = loadApi();
  const store = storage();
  const first = await api.recordRateLimit(store, 'incident-a', () => 100_000);
  assert.equal(first.level, 1);
  assert.equal(first.cooldownUntil, 220_000);
  const duplicate = await api.recordRateLimit(store, 'incident-a', () => 101_000);
  assert.equal(duplicate.level, 1);
  assert.equal(duplicate.duplicate, true);
  const second = await api.recordRateLimit(store, 'incident-b', () => 161_000);
  assert.equal(second.level, 2);
  assert.equal(api.batchLimit(1, 6), 2);
  assert.equal(api.batchLimit(2, 6), 1);
  const blocked = await api.gate(store, () => 161_001);
  assert.equal(blocked.allowed, false);
  assert.ok(blocked.waitMs >= 239_000);
});

test('post-cooldown request gap is enforced and healthy time decays pacing level', async () => {
  const api = loadApi();
  const store = storage();
  const state = await api.recordRateLimit(store, 'incident-a', () => 100_000);
  await api.markRequest(store, () => state.cooldownUntil);
  const gap = await api.gate(store, () => state.cooldownUntil + 1);
  assert.equal(gap.allowed, false);
  assert.equal(gap.minGapMs, 10_000);
  assert.ok(gap.waitMs >= 9_999);
  const decayed = await api.noteHealthy(store, () => 100_000 + api.DECAY_WINDOW_MS + 1);
  assert.equal(decayed.level, 0);
  const open = await api.gate(store, () => state.cooldownUntil + api.DECAY_WINDOW_MS + 20_000);
  assert.equal(open.level, 0);
  assert.equal(open.allowed, true);
});
