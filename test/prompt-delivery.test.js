import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(
  new URL('../extension/components/prompt-delivery/controller.js', import.meta.url),
  'utf8'
);

function load(href = 'https://chatgpt.com/') {
  class FakeEvent {
    constructor(type, detail = {}) { this.type = type; Object.assign(this, detail); }
  }
  const sandbox = {
    URL,
    location: { href },
    Event: FakeEvent,
    InputEvent: FakeEvent,
    setTimeout,
    getComputedStyle: () => ({ visibility: 'visible', display: 'block' }),
    console
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox);
  return sandbox.ChatSentinelPromptDelivery;
}

test('prompt query contamination is detected and clean URLs remain clean', () => {
  const api = load();
  assert.equal(api.containsPromptQuery('https://chatgpt.com/?prompt-textarea=SECRET'), true);
  assert.equal(api.containsPromptQuery('https://chatgpt.com/?foo=bar'), false);
});

test('delivery evidence requires a matching user turn and rejects contaminated URLs', () => {
  const api = load();
  const composer = { value: '' };
  const user = { innerText: 'Build feature X' };
  const root = {
    querySelector(selector) { return selector.includes('prompt-textarea') ? composer : null; },
    querySelectorAll(selector) { return selector.includes('data-message-author-role') ? [user] : []; }
  };
  const good = api.inspect(root, 'Build feature X', 'https://chatgpt.com/c/abc');
  assert.equal(good.confirmed, true);
  assert.equal(good.userTurnMatched, true);
  const bad = api.inspect(root, 'Build feature X', 'https://chatgpt.com/?prompt-textarea=Build+feature+X');
  assert.equal(bad.confirmed, false);
  assert.equal(bad.contaminatedUrl, true);
});

test('prepare ignores a generic GET submit trap and uses the explicit ChatGPT send control', async () => {
  const api = load();
  let genericClicks = 0;
  let verifiedClicks = 0;
  const generic = {
    disabled: false,
    getBoundingClientRect: () => ({ width: 20, height: 20 }),
    click() { genericClicks += 1; }
  };
  const verified = {
    hidden: true,
    disabled: false,
    getBoundingClientRect() { return this.hidden ? { width: 0, height: 0 } : { width: 20, height: 20 }; },
    click() { verifiedClicks += 1; }
  };
  const composer = {
    value: '',
    focus() {},
    dispatchEvent(event) { if (event.type === 'input' && this.value) verified.hidden = false; return true; }
  };
  const root = {
    querySelector(selector) {
      if (selector === '#prompt-textarea') return composer;
      if (selector === 'button[data-testid="send-button"]') return verified;
      if (selector === 'button[aria-label="Send"]') return generic;
      return null;
    }
  };
  const prepared = await api.prepare(root, 'lane prompt', { timeoutMs: 200 });
  assert.equal(prepared.ok, true);
  assert.equal(prepared.sendButton, verified);
  const clicked = api.click(prepared);
  assert.equal(clicked.ok, true);
  assert.equal(verifiedClicks, 1);
  assert.equal(genericClicks, 0);
});
