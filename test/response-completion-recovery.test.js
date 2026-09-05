import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(
  new URL('../extension/components/response-completion-recovery/controller.js', import.meta.url),
  'utf8'
);

function loadApi() {
  const sandbox = {};
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox);
  return sandbox.ChatSentinelResponseCompletion;
}

function turn(role, text, id) {
  return {
    innerText: text,
    id: '',
    getAttribute(name) {
      if (name === 'data-message-author-role') return role;
      if (name === 'data-message-id') return id || '';
      return '';
    },
    closest() { return null; }
  };
}

function documentWithTurns(turns) {
  return {
    querySelectorAll() { return turns; },
    body: { innerText: turns.map(row => row.innerText).join('\n') }
  };
}

test('active interruption belongs to the latest unfinished assistant turn', () => {
  const api = loadApi();
  const root = documentWithTurns([
    turn('user', 'Do the work', 'u1'),
    turn('assistant', 'Partial answer\\nConnection interrupted. Waiting for the complete answer', 'a1')
  ]);
  const result = api.inspect(root);
  assert.equal(result.active, true);
  assert.equal(result.source, 'turn-timeline');
  assert.equal(result.incidentKey, 'message:a1');
});

test('historical interruption is inactive after a later user and completed assistant turn', () => {
  const api = loadApi();
  const root = documentWithTurns([
    turn('assistant', 'Connection interrupted. Waiting for the complete answer', 'a1'),
    turn('user', 'Continue', 'u2'),
    turn('assistant', 'Completed answer', 'a2')
  ]);
  const result = api.inspect(root);
  assert.equal(result.active, false);
  assert.equal(api.isActiveInterruptionTimeline(result.events), false);
});

function externalMarkerDocument(turns, markerText, markerOrder) {
  const marker = {
    innerText: markerText,
    id: '',
    getAttribute() { return ''; },
    closest() { return null; },
    compareDocumentPosition(node) { return Number(node.order) > markerOrder ? 4 : 0; }
  };
  return {
    querySelectorAll(selector) {
      if (selector === '[data-message-author-role]') return turns;
      return [marker];
    },
    body: { innerText: turns.map(row => row.innerText).join('\n') + '\n' + markerText }
  };
}

test('external interruption marker after the latest turn is active', () => {
  const api = loadApi();
  const turns = [turn('assistant', 'Partial answer', 'a1')];
  turns[0].order = 1;
  const root = externalMarkerDocument(turns, 'Connection interrupted. Waiting for the complete answer', 2);
  const result = api.inspect(root);
  assert.equal(result.active, true);
  assert.equal(result.source, 'page-marker');
});

test('external interruption marker is historical when a later user or assistant turn exists', () => {
  const api = loadApi();
  const turns = [turn('assistant', 'Partial answer', 'a1'), turn('user', 'Continue', 'u1'), turn('assistant', 'Completed answer', 'a2')];
  turns[0].order = 1;
  turns[1].order = 3;
  turns[2].order = 4;
  const root = externalMarkerDocument(turns, 'Connection interrupted. Waiting for the complete answer', 2);
  const result = api.inspect(root);
  assert.equal(result.active, false);
  assert.equal(result.source, 'page-marker');
});

test('page fallback still detects an active connection interruption when turn metadata is unavailable', () => {
  const api = loadApi();
  const root = {
    querySelectorAll() { return []; },
    body: { innerText: 'Connection interrupted. Waiting for the complete answer' }
  };
  const result = api.inspect(root);
  assert.equal(result.active, true);
  assert.equal(result.source, 'page-fallback');
});

test('continuation prompt requires exact continuation, durable reconciliation and complete final answer', () => {
  const api = loadApi();
  const prompt = api.buildContinuationPrompt({
    reconciliation: { branch: 'feat/a', head: 'abc', remoteHead: 'def' }
  });
  assert.match(prompt, /previous response was interrupted/i);
  assert.match(prompt, /complete remaining answer/i);
  assert.match(prompt, /do not restart/i);
  assert.match(prompt, /reconcile the current durable state/i);
  assert.match(prompt, /complete final answer/i);
  assert.match(prompt, /branch: feat\/a/);
});

test('one active interruption incident is deduplicated during the attempt cooldown', () => {
  const api = loadApi();
  const root = documentWithTurns([
    turn('assistant', 'Connection interrupted. Waiting for the complete answer', 'a1')
  ]);
  const values = new Map();
  const storage = {
    getItem(key) { return values.get(key) || null; },
    setItem(key, value) { values.set(key, value); }
  };
  const first = api.prepareAttempt(root, storage, 100000, 30000);
  assert.equal(first.allowed, true);
  assert.equal(api.markAttempt(first, storage, 100000), true);
  const duplicate = api.prepareAttempt(root, storage, 101000, 30000);
  assert.equal(duplicate.allowed, false);
  assert.equal(duplicate.deduplicated, true);
  const retry = api.prepareAttempt(root, storage, 131000, 30000);
  assert.equal(retry.allowed, true);
});
