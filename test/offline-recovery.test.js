import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../extension/components/offline-recovery/controller.js', import.meta.url), 'utf8');

function loadApi() {
  const sandbox = {
    document: { documentElement: null },
    sessionStorage: { getItem() { return null; }, setItem() {}, removeItem() {} },
    location: { href: 'https://chatgpt.com/c/test', reload() {} },
    navigator: { clipboard: { async writeText() {} } },
    chrome: { runtime: { openOptionsPage() {} } },
    setTimeout,
    Date,
    Event: class { constructor(type) { this.type = type; } }
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox);
  return sandbox.ChatSentinelOfflineRecovery;
}

test('offline recovery distinguishes extension invalidation from watchdog and pairing failures', () => {
  const api = loadApi();
  assert.equal(api.classify(false, null).state, 'extension-disconnected');
  assert.equal(api.classify(true, { ok: false }).state, 'watchdog-offline');
  assert.equal(api.classify(true, { ok: false, error: 'extension-origin-mismatch' }).state, 'pairing-mismatch');
  assert.equal(api.classify(true, { ok: true }).state, 'online');
});

test('recovery button labels are explicit and not a generic refresh', () => {
  const api = loadApi();
  assert.equal(api.buttonLabel({ state: 'extension-disconnected' }), 'Reconnect ChatSentinel');
  assert.equal(api.buttonLabel({ state: 'watchdog-offline' }), 'Repair ChatSentinel');
  assert.equal(api.buttonLabel({ state: 'pairing-mismatch' }), 'Repair pairing');
  assert.equal(api.buttonLabel({ state: 'online' }), 'Connected');
});

test('generation detection prevents destructive reload while an answer is still running', () => {
  const api = loadApi();
  const running = { querySelectorAll() { return [{ getAttribute() { return 'Stop generating'; }, textContent: '' }]; } };
  const idle = { querySelectorAll() { return [{ getAttribute() { return 'Send'; }, textContent: '' }]; } };
  assert.equal(api.isGenerationRunning(running), true);
  assert.equal(api.isGenerationRunning(idle), false);
});

test('draft preservation and restoration are bounded and never auto-send', () => {
  const api = loadApi();
  const values = new Map();
  const storage = {
    setItem(key, value) { values.set(key, value); },
    getItem(key) { return values.get(key) || null; },
    removeItem(key) { values.delete(key); }
  };
  const composer = { value: 'unsent draft', dispatchEvent(event) { this.lastEvent = event.type; } };
  const sourceRoot = { querySelector() { return composer; } };
  assert.equal(api.preserveDraft(sourceRoot, storage), true);
  composer.value = '';
  assert.equal(api.restoreDraft(sourceRoot, storage), true);
  assert.equal(composer.value, 'unsent draft');
  assert.equal(composer.lastEvent, 'input');
  assert.equal(values.has(api.DRAFT_KEY), false);
});
