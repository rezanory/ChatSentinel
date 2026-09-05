import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const guardSource = fs.readFileSync(
  new URL('../extension/components/runtime-context-guard/controller.js', import.meta.url),
  'utf8'
);
const contentSource = fs.readFileSync(
  new URL('../extension/content.js', import.meta.url),
  'utf8'
);

function loadGuard(chrome) {
  const sandbox = { chrome, console };
  vm.createContext(sandbox);
  vm.runInContext(guardSource, sandbox);
  return { sandbox, api: sandbox.ChatSentinelRuntimeContext };
}

test('runtime guard sends normally while the extension context is alive', async () => {
  let sent = 0;
  const runtime = {
    id: 'extension-id',
    sendMessage: async message => { sent += 1; return { ok: true, message }; },
    onMessage: { addListener() {}, removeListener() {} }
  };
  const { api } = loadGuard({ runtime });
  assert.equal(api.isAlive(), true);
  const result = await api.sendMessage({ type: 'PING' });
  assert.equal(result.ok, true);
  assert.equal(sent, 1);
});

test('runtime guard converts invalidated and missing runtime failures into bounded results', async () => {
  const throwing = loadGuard({
    runtime: {
      id: 'extension-id',
      sendMessage() { throw new Error('Extension context invalidated.'); },
      onMessage: { addListener() {}, removeListener() {} }
    }
  }).api;
  const thrown = await throwing.sendMessage({ type: 'PING' });
  assert.equal(thrown.ok, false);
  assert.equal(thrown.invalidated, true);
  assert.equal(thrown.reason, 'extension-context-invalidated');

  const missing = loadGuard({}).api;
  assert.equal(missing.isAlive(), false);
  const absent = await missing.sendMessage({ type: 'PING' });
  assert.equal(absent.invalidated, true);
  assert.equal(missing.addMessageListener(() => {}), false);
});

test('content heartbeat shuts down instead of throwing after extension reload invalidates runtime', async () => {
  let intervalCallback;
  let observerCallback;
  let disconnected = false;
  let cleared = false;
  let sends = 0;
  const listeners = new Set();
  const runtime = {
    id: 'extension-id',
    sendMessage() { sends += 1; return Promise.resolve({ ok: true }); },
    onMessage: {
      addListener(fn) { listeners.add(fn); },
      removeListener(fn) { listeners.delete(fn); }
    }
  };
  const sandbox = {
    chrome: { runtime },
    console,
    location: { href: 'https://chatgpt.com/c/test-chat', hostname: 'chatgpt.com', port: '' },
    document: {
      documentElement: { dataset: {} },
      body: { innerText: '' },
      querySelectorAll() { return []; }
    },
    sessionStorage: {
      getItem() { return null; },
      setItem() {},
      removeItem() {}
    },
    MutationObserver: class {
      constructor(callback) { observerCallback = callback; }
      observe() {}
      disconnect() { disconnected = true; }
    },
    setInterval(callback) { intervalCallback = callback; return 7; },
    clearInterval(id) { if (id === 7) cleared = true; },
    setTimeout() { return 1; }
  };
  sandbox.window = sandbox;
  sandbox.ChatSentinelIdentity = { resolve: () => ({ id: 'chat-test', source: 'test' }) };
  sandbox.ChatSentinelActuator = { consumePendingPrompt: () => null };
  vm.createContext(sandbox);
  vm.runInContext(guardSource, sandbox);
  vm.runInContext(contentSource, sandbox);
  await Promise.resolve();
  await Promise.resolve();

  assert.equal(typeof intervalCallback, 'function');
  assert.equal(typeof observerCallback, 'function');
  assert.ok(sends >= 1);

  sandbox.chrome.runtime = undefined;
  assert.doesNotThrow(() => intervalCallback());
  assert.equal(disconnected, true);
  assert.equal(cleared, true);
  assert.doesNotThrow(() => observerCallback());
});

test('project console no longer directly calls chrome.runtime.sendMessage', () => {
  const source = fs.readFileSync(new URL('../extension/project-console.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /return\s+chrome\.runtime\.sendMessage\(message\)/);
  assert.match(source, /ChatSentinelRuntimeContext/);
});
