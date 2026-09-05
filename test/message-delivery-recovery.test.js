import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(
  new URL('../extension/components/message-delivery-recovery/controller.js', import.meta.url),
  'utf8'
);

function loadApi() {
  const sandbox = { location: { pathname: '/c/test-chat' } };
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox);
  return sandbox.ChatSentinelMessageDeliveryRecovery;
}

function node({ text = '', role = '', id = '', label = '', order = 0, alert = false } = {}) {
  const item = {
    innerText: text,
    id: '',
    disabled: false,
    order,
    parentElement: null,
    children: [],
    clickCount: 0,
    click() { this.clickCount += 1; },
    getAttribute(name) {
      if (name === 'data-message-author-role') return role;
      if (name === 'data-message-id') return id;
      if (name === 'aria-label') return label;
      if (name === 'role') return alert ? 'alert' : '';
      return '';
    },
    querySelectorAll(selector) {
      return selector === 'button' ? this.children.filter(child => child.kind === 'button') : [];
    },
    closest(selector) {
      if (selector === '[role="alert"]') {
        if (alert) return this;
        let current = this.parentElement;
        while (current) {
          if (current.alert) return current;
          current = current.parentElement;
        }
      }
      if (selector === '[data-message-id]' && id) return this;
      return null;
    },
    compareDocumentPosition(other) {
      return this.order < other.order ? 4 : this.order > other.order ? 2 : 0;
    },
    alert,
    kind: label ? 'button' : 'node'
  };
  return item;
}
function alertWithRetry({ order = 2, id = 'timeout-1' } = {}) {
  const marker = node({
    text: 'Message delivery timed out. Please try again. Retry',
    id,
    order,
    alert: true
  });
  const button = node({ label: 'Retry', order: order + 0.1 });
  button.parentElement = marker;
  marker.children.push(button);
  return { marker, button };
}

function documentFixture({ turns = [], markers = [], textMarkers = [], buttons = [] } = {}) {
  const bodyText = [...turns, ...markers, ...textMarkers].map(row => row.innerText).join('\n');
  const textNodes = textMarkers.map(marker => ({ nodeValue: marker.innerText, parentElement: marker, parentNode: marker }));
  return {
    body: { innerText: bodyText, textContent: bodyText },
    querySelectorAll(selector) {
      if (selector === '[data-message-author-role]') return turns;
      if (selector === 'button') return buttons;
      if (selector.startsWith('[role="alert"]')) return markers;
      return [];
    },
    createTreeWalker() {
      let index = 0;
      return { nextNode() { return textNodes[index++] || null; } };
    }
  };
}

function attach(parent, ...children) {
  for (const child of children) {
    child.parentElement = parent;
    parent.children.push(child);
  }
  return parent;
}
function redComposerTimeout({ order = 2 } = {}) {
  const banner = node({ text: 'Message delivery timed out. Retry', order });
  const marker = node({ text: 'Message delivery timed out.', order: order + 0.02 });
  const copyWrap = node({ text: 'Message delivery timed out.', order: order + 0.01 });
  const actionWrap = node({ text: 'Retry', order: order + 0.03 });
  const button = node({ label: 'Retry', order: order + 0.04 });
  attach(copyWrap, marker);
  attach(actionWrap, button);
  attach(banner, copyWrap, actionWrap);
  return { marker, button };
}

function memoryStorage() {
  const values = new Map();
  return {
    getItem(key) { return values.get(key) || null; },
    setItem(key, value) { values.set(key, value); }
  };
}
test('active message delivery timeout requires the associated native Retry button', () => {
  const api = loadApi();
  const user = node({ text: 'Do the work', role: 'user', id: 'u1', order: 1 });
  const { marker, button } = alertWithRetry({ order: 2, id: 'delivery-u1' });
  const result = api.inspect(documentFixture({ turns: [user], markers: [marker], buttons: [button] }));
  assert.equal(result.active, true);
  assert.equal(result.timeoutMarkerPresent, true);
  assert.equal(result.retryVisible, true);
  assert.equal(result.retryButton, button);
  assert.equal(result.incidentKey, 'message:delivery-u1');
});

test('current red composer timeout is discovered outside main without role=alert and binds sibling Retry', () => {
  const api = loadApi();
  const user = node({ text: 'Do the work', role: 'user', id: 'red-user', order: 1 });
  const { marker, button } = redComposerTimeout({ order: 2 });
  const result = api.inspect(documentFixture({ turns: [user], textMarkers: [marker], buttons: [button] }));
  assert.equal(result.active, true);
  assert.equal(result.timeoutMarkerPresent, true);
  assert.equal(result.retryButton, button);
  assert.equal(result.incidentKey, 'user:red-user');
});

test('red composer timeout ignores an unrelated Retry outside the local timeout region', () => {
  const api = loadApi();
  const { marker } = redComposerTimeout({ order: 2 });
  const unrelated = node({ text: 'Retry', label: 'Retry', order: 10 });
  const result = api.inspect(documentFixture({ textMarkers: [marker], buttons: [unrelated] }));
  assert.equal(result.active, false);
  assert.equal(result.timeoutMarkerPresent, true);
  assert.equal(result.reason, 'retry-button-missing');
});

test('disabled associated Retry is not actionable', () => {
  const api = loadApi();
  const { marker, button } = redComposerTimeout({ order: 2 });
  button.disabled = true;
  const result = api.inspect(documentFixture({ textMarkers: [marker], buttons: [button] }));
  assert.equal(result.active, false);
  assert.equal(result.reason, 'retry-button-missing');
});

test('generic Retry without delivery-timeout marker is not classified as message delivery failure', () => {
  const api = loadApi();
  const retry = node({ label: 'Retry', order: 2 });
  const result = api.inspect(documentFixture({ buttons: [retry] }));
  assert.equal(result.active, false);
  assert.equal(result.timeoutMarkerPresent, false);
  assert.equal(result.reason, 'marker-missing');
});

test('historical delivery timeout does not reactivate after a later conversation turn', () => {
  const api = loadApi();
  const { marker, button } = alertWithRetry({ order: 2 });
  const later = node({ text: 'Delivered follow-up', role: 'assistant', id: 'a2', order: 3 });
  const result = api.inspect(documentFixture({ turns: [later], markers: [marker], buttons: [button] }));
  assert.equal(result.active, false);
  assert.equal(result.timeoutMarkerPresent, true);
  assert.equal(result.reason, 'historical-marker');
});
test('delivery retry attempts are cooldown-deduplicated and bounded to two native retries', () => {
  const api = loadApi();
  const { marker, button } = alertWithRetry({ order: 2, id: 'delivery-2' });
  const root = documentFixture({ markers: [marker], buttons: [button] });
  const storage = memoryStorage();

  const first = api.prepareAttempt(root, storage, 10000, { cooldownMs: 5000, maxAttempts: 2 });
  assert.equal(first.allowed, true);
  assert.equal(api.markAttempt(first, storage, 10000), true);
  assert.equal(api.retryCount(first.observation.incidentKey, storage), 1);

  const duplicate = api.prepareAttempt(root, storage, 12000, { cooldownMs: 5000, maxAttempts: 2 });
  assert.equal(duplicate.allowed, false);
  assert.equal(duplicate.deduplicated, true);

  const second = api.prepareAttempt(root, storage, 16000, { cooldownMs: 5000, maxAttempts: 2 });
  assert.equal(second.allowed, true);
  api.markAttempt(second, storage, 16000);
  const exhausted = api.prepareAttempt(root, storage, 22000, { cooldownMs: 5000, maxAttempts: 2 });
  assert.equal(exhausted.allowed, false);
  assert.equal(exhausted.reason, 'retry-budget-exhausted');
  assert.equal(api.retryCount(second.observation.incidentKey, storage), 2);
});
