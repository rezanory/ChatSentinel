import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../extension/components/offline-recovery/controller.js', import.meta.url), 'utf8');

function loadContext(overrides = {}) {
  const values = new Map();
  const sandbox = {
    document: { documentElement: null, getElementById() { return null; } },
    sessionStorage: {
      getItem(key) { return values.get(key) || null; },
      setItem(key, value) { values.set(key, value); },
      removeItem(key) { values.delete(key); }
    },
    location: { href: 'https://chatgpt.com/c/test', reload() { this.reloaded = true; } },
    navigator: { clipboard: { async writeText(value) { sandbox.copied = value; } } },
    chrome: { runtime: { openOptionsPage() { sandbox.optionsOpened = true; } } },
    setTimeout,
    Date,
    Event: class { constructor(type) { this.type = type; } },
    ...overrides
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox);
  return { api: sandbox.ChatSentinelOfflineRecovery, sandbox, values };
}

function loadApi() { return loadContext().api; }

test('offline recovery distinguishes extension invalidation from watchdog and pairing failures', () => {
  const api = loadApi();
  assert.equal(api.classify(false, null).state, 'extension-disconnected');
  assert.equal(api.classify(true, { ok: false }).state, 'watchdog-offline');
  assert.equal(api.classify(true, { ok: false, error: 'extension-origin-mismatch' }).state, 'pairing-mismatch');
  assert.equal(api.classify(true, { ok: true }).state, 'online');
});

test('recovery button labels stay actionable across health changes', () => {
  const api = loadApi();
  assert.equal(api.buttonLabel({ state: 'extension-disconnected' }), 'Reconnect ChatSentinel');
  assert.equal(api.buttonLabel({ state: 'watchdog-offline' }), 'Repair ChatSentinel');
  assert.equal(api.buttonLabel({ state: 'pairing-mismatch' }), 'Repair pairing');
  assert.equal(api.buttonLabel({ state: 'online' }), 'Connected · Check');
  assert.match(api.REPAIR_COMMAND, /recover-runtime\.ps1$/i);
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

test('invalidated MV3 context reloads the idle tab and preserves an unsent draft', async () => {
  const { api, sandbox, values } = loadContext({
    ChatSentinelRuntimeContext: { isAlive: () => false }
  });
  const draft = { value: 'keep this draft' };
  const root = {
    querySelectorAll() { return []; },
    querySelector() { return draft; }
  };
  const result = await api.recover(root);
  assert.equal(result.action, 'reload-tab');
  assert.equal(sandbox.location.reloaded, true);
  assert.equal(values.get(api.DRAFT_KEY), 'keep this draft');
});

test('invalidated MV3 context never reloads while a response is still generating', async () => {
  const { api, sandbox } = loadContext({
    ChatSentinelRuntimeContext: { isAlive: () => false }
  });
  const root = {
    querySelectorAll() { return [{ getAttribute() { return 'Stop generating'; }, textContent: '' }]; },
    querySelector() { return null; }
  };
  const result = await api.recover(root);
  assert.equal(result.action, 'wait');
  assert.notEqual(sandbox.location.reloaded, true);
});

test('offline recovery is loaded by manifest and every bounded reinjection path', () => {
  const manifest = JSON.parse(fs.readFileSync(new URL('../extension/manifest.json', import.meta.url), 'utf8'));
  const scripts = manifest.content_scripts.flatMap(row => row.js || []);
  assert.ok(scripts.includes('components/offline-recovery/controller.js'));

  const background = fs.readFileSync(new URL('../extension/background.js', import.meta.url), 'utf8');
  const executor = fs.readFileSync(new URL('../extension/command-executor.js', import.meta.url), 'utf8');
  assert.match(background, /const CONTENT_SCRIPT_FILES = Object\.freeze\([\s\S]*'project-console\.js',[\s\S]*'components\/offline-recovery\/controller\.js'/);
  assert.match(background, /files: CONTENT_SCRIPT_FILES/);
  assert.match(executor, /project-console\.js', 'components\/offline-recovery\/controller\.js'/);
});

test('stale project panel listeners are rebound once in a newly injected MV3 context', () => {
  const panel = fs.readFileSync(new URL('../extension/project-console.js', import.meta.url), 'utf8');
  assert.match(panel, /let boundShadow = null;/);
  assert.match(panel, /if \(host\?\.shadowRoot\)[\s\S]*shadow = host\.shadowRoot;[\s\S]*bindPanelEventsOnce\(\);/);
  assert.match(panel, /function bindPanelEventsOnce\(\)[\s\S]*boundShadow === shadow/);
  assert.match(panel, /bindEvents\(\);[\s\S]*restorePanelWidth\(\);[\s\S]*boundShadow = shadow;/);
});

test('Setup Assistant exposes the bounded runtime recovery action', () => {
  const html = fs.readFileSync(new URL('../extension/setup.html', import.meta.url), 'utf8');
  const setup = fs.readFileSync(new URL('../extension/setup.js', import.meta.url), 'utf8');
  assert.match(html, /id="recoverRuntime"/);
  assert.match(setup, /recover-runtime\.ps1/);
  assert.match(setup, /Watchdog is offline/);
});


test('project console exposes bounded Remote Desktop Commander recovery controls', () => {
  const panel = fs.readFileSync(new URL('../extension/project-console.js', import.meta.url), 'utf8');
  assert.match(panel, /id="rdcRecoveryCard"/);
  assert.match(panel, /Recover Remote Desktop Commander/);
  assert.match(panel, /\/recovery\/remote-desktop-commander/);
  assert.match(panel, /lightweight @wonderwhy-er\/desktop-commander agent/);
});
