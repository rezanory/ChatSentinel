import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';

const ROOT = path.resolve('.');
const execFileAsync = promisify(execFile);
const TEST_PORT = 4318;
const EXPECTED_EXTENSION_ID = 'pcidbmcahljjpbmaecjmfmpbpfnpoepc';
const WATCHDOG = `http://127.0.0.1:${TEST_PORT}`;
const CHROME = process.env.CHROME_BIN || await findTestChromium() || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const sourceExtension = path.join(ROOT, 'extension');
const extension = path.join(os.tmpdir(), `chatsentinel-e2e-extension-${process.pid}`);
const RUN = `e2e-${process.pid}-${Date.now()}`;
const profile = path.join(os.tmpdir(), `chatsentinel-e2e-profile-${process.pid}`);
const testData = path.join(os.tmpdir(), `chatsentinel-e2e-data-${process.pid}`);
await prepareTestExtension(sourceExtension, extension);
const cleanProject = await prepareCleanProject(testData);
const fixture = spawn(process.execPath, ['scripts/e2e/fault-fixture-server.js'], {
  cwd: ROOT,
  stdio: 'ignore'
});
const watchdog = spawn(process.execPath, ['src/local-watchdog.js'], {
  cwd: ROOT,
  stdio: 'ignore',
  env: {
    ...process.env,
    CHATSENTINEL_PORT: String(TEST_PORT),
    CHATSENTINEL_DATA_DIR: testData,
    CHATSENTINEL_TEST_MODE: '1'
  }
});
let chrome;
let DEVTOOLS;

try {
  await waitUrl('http://127.0.0.1:4320/idle');
  const health = await waitJson(`${WATCHDOG}/health`);
  assert.equal(health.version, '1.0.0', 'v1.0 watchdog must be running');

  chrome = spawn(CHROME, [
    `--user-data-dir=${profile}`,
    '--remote-debugging-port=0',
    '--remote-debugging-address=127.0.0.1',
    `--disable-extensions-except=${extension}`,
    `--load-extension=${extension}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-sync',
    fixtureUrl('idle')
  ], { stdio: 'ignore' });

  const debugPort = await waitDevToolsPort(profile);
  DEVTOOLS = `http://127.0.0.1:${debugPort}`;
  await waitJson(`${DEVTOOLS}/json/version`);
  const extensionWorker = await waitTarget(target => target.type === 'service_worker' && target.url.endsWith('/background.js'));
  assert.ok(extensionWorker.url.startsWith(`chrome-extension://${EXPECTED_EXTENSION_ID}/`), `unexpected extension id: ${extensionWorker.url}`);
  await sleep(500);
  await detectorSuite();
  await actuatorSuite();
  console.log('ChatSentinel browser E2E: PASS');
} finally {
  chrome?.kill();
  fixture.kill();
  watchdog.kill();
  await fs.rm(profile, { recursive: true, force: true }).catch(() => {});
  await fs.rm(testData, { recursive: true, force: true }).catch(() => {});
  await fs.rm(extension, { recursive: true, force: true }).catch(() => {});
}

async function detectorSuite() {
  await verifyDecision('running', 'WAIT');
  await verifyDecision('retry', 'ESCALATE');
  await verifyDecision('interrupt', 'RELOAD_AND_RECHECK');
  await verifyDecision('dead', 'CONTINUE_NEW_CHAT');
  await verifyDecision('frozen', 'RELOAD_AND_RECHECK');
  console.log('detector/recovery E2E: 5/5 PASS');
}

async function actuatorSuite() {
  await postJson('/conversation/register', {
    conversationId: `${RUN}-retry-auto`,
    operationClass: 'read_only'
  });
  const retryTarget = await openPage(fixtureUrl('retry', {
    auto: '1', cid: `${RUN}-retry-auto`
  }));
  await waitEval(retryTarget, "document.body.dataset.retryClicked === '1'");
  console.log('SAFE_RETRY actuator: PASS');

  const cycleId = `${RUN}-retry-cycle`;
  await postJson('/conversation/register', { conversationId: cycleId, operationClass: 'read_only' });
  let cycleTarget = await openPage(fixtureUrl('retry', { auto: '1', cid: cycleId }));
  await waitEval(cycleTarget, "document.body.dataset.retryClicked === '1'");
  cycleTarget = await openPage(fixtureUrl('retry', { auto: '1', cid: cycleId }));
  await waitEval(cycleTarget, "document.body.dataset.retryClicked === '1'");
  await openPage(fixtureUrl('idle', { auto: '1', cid: cycleId }));
  await sleep(600);
  cycleTarget = await openPage(fixtureUrl('retry', { auto: '1', cid: cycleId }));
  await waitEval(cycleTarget, "document.body.dataset.retryClicked === '1'");
  console.log('SAFE_RETRY incident counter reset: PASS');

  await postJson('/conversation/register', {
    conversationId: `${RUN}-interrupt-auto`,
    projectPath: cleanProject,
    operationClass: 'write'
  });
  const continueTarget = await openPage(fixtureUrl('interrupt', {
    auto: '1', cid: `${RUN}-interrupt-auto`
  }));
  await waitEval(continueTarget, "Boolean(document.body.dataset.sent)");
  const sent = await evalValue(continueTarget, 'document.body.dataset.sent');
  assert.match(sent, /reconcile|checkpoint|SHA/i);
  console.log('CONTINUE_SAME_CHAT actuator: PASS');

  const deadId = `${RUN}-dead-auto`;
  const deadTarget = await openPage(fixtureUrl('dead', { auto: '1', cid: deadId }));
  await waitEval(deadTarget, "location.pathname === '/newchat' && Boolean(document.body.dataset.sent)");
  const handoff = await evalValue(deadTarget, 'document.body.dataset.sent');
  assert.match(handoff, /checkpoint|source-of-truth|ادامه پروژه/i);
  console.log('CONTINUE_NEW_CHAT + handoff actuator: PASS');
}

async function verifyDecision(kind, expectedAction) {
  const id = `${RUN}-${kind}`;
  await openPage(fixtureUrl(kind, { cid: id }));
  const row = await waitForSession(id);
  assert.equal(row.decision?.action, expectedAction, `${kind} decision`);
  console.log(`${kind}: ${row.decision.action} PASS`);
}

function fixtureUrl(kind, extra = {}) {
  const params = new URLSearchParams({ watchdog: String(TEST_PORT), ...extra });
  return `http://127.0.0.1:4320/${kind}?${params}`;
}

async function openPage(url) {
  const encoded = encodeURIComponent(url);
  const res = await fetch(`${DEVTOOLS}/json/new?${encoded}`, { method: 'PUT' });
  if (!res.ok) throw new Error(`cannot open ${url}: ${res.status}`);
  return await res.json();
}

async function waitForSession(id) {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    const state = await fetch(`${WATCHDOG}/supervisor`).then(r => r.json());
    const row = state.sessions?.find(item => item.id === id);
    if (row?.decision) return row;
    await sleep(250);
  }
  const snapshot = await fetch(`${WATCHDOG}/supervisor`).then(r => r.text()).catch(() => 'unavailable');
  const targets = await fetch(`${DEVTOOLS}/json/list`).then(r => r.text()).catch(() => 'unavailable');
  throw new Error(`session ${id} not observed; supervisor=${snapshot}; targets=${targets}`);
}

async function postJson(route, body) {
  const res = await fetch(`${WATCHDOG}${route}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  });
  const json = await res.json();
  if (!res.ok) throw new Error(`${route}: ${JSON.stringify(json)}`);
  return json;
}

async function waitTarget(predicate) {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    const targets = await waitJson(`${DEVTOOLS}/json/list`);
    const target = targets.find(predicate);
    if (target?.webSocketDebuggerUrl) return target;
    await sleep(200);
  }
  throw new Error('matching CDP target not found');
}

async function waitEval(target, expression) {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    if (await evalValue(target, expression)) return true;
    await sleep(200);
  }
  throw new Error(`condition did not become true: ${expression}`);
}

async function evalValue(target, expression) {
  const reply = await cdp(target, 'Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true
  });
  return reply?.result?.result?.value;
}

async function cdp(target, method, params = {}) {
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true });
    ws.addEventListener('error', reject, { once: true });
  });
  const id = Math.floor(Math.random() * 1_000_000) + 1;
  const response = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`CDP timeout: ${method}`)), 5000);
    ws.addEventListener('message', event => {
      const message = JSON.parse(event.data);
      if (message.id !== id) return;
      clearTimeout(timer);
      resolve(message);
    });
  });
  ws.send(JSON.stringify({ id, method, params }));
  const result = await response;
  ws.close();
  if (result.error) throw new Error(JSON.stringify(result.error));
  return result;
}

async function waitDevToolsPort(profileDir) {
  const file = path.join(profileDir, 'DevToolsActivePort');
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    try {
      const [port] = (await fs.readFile(file, 'utf8')).trim().split(/\r?\n/);
      if (/^\d+$/.test(port)) return Number(port);
    } catch {}
    await sleep(150);
  }
  throw new Error('DevToolsActivePort was not created');
}

async function waitJson(url) {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.ok) return await res.json();
    } catch {}
    await sleep(200);
  }
  throw new Error(`timeout waiting for ${url}`);
}

async function waitUrl(url) {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {}
    await sleep(200);
  }
  throw new Error(`timeout waiting for ${url}`);
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function prepareTestExtension(source, destination) {
  await fs.rm(destination, { recursive: true, force: true });
  await fs.cp(source, destination, { recursive: true });
  const manifestPath = path.join(destination, 'manifest.json');
  const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
  manifest.content_scripts[0].matches.push('http://127.0.0.1/*');
  await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
}

async function prepareCleanProject(base) {
  const project = path.join(base, 'project');
  const remote = path.join(base, 'remote.git');
  await fs.mkdir(project, { recursive: true });
  await execFileAsync('git', ['init', '-b', 'main'], { cwd: project });
  await execFileAsync('git', ['config', 'user.email', 'chatsentinel@test.local'], { cwd: project });
  await execFileAsync('git', ['config', 'user.name', 'ChatSentinel Test'], { cwd: project });
  await fs.writeFile(path.join(project, 'checkpoint.txt'), 'clean checkpoint\n', 'utf8');
  await execFileAsync('git', ['add', '.'], { cwd: project });
  await execFileAsync('git', ['commit', '-m', 'test checkpoint'], { cwd: project });
  await execFileAsync('git', ['init', '--bare', remote]);
  await execFileAsync('git', ['remote', 'add', 'origin', remote], { cwd: project });
  await execFileAsync('git', ['push', '-u', 'origin', 'main'], { cwd: project });
  return project;
}

async function findTestChromium() {
  const base = path.join(process.env.LOCALAPPDATA || '', 'ms-playwright');
  try {
    const entries = (await fs.readdir(base)).filter(x => x.startsWith('chromium-')).sort().reverse();
    for (const entry of entries) {
      for (const rel of ['chrome-win64/chrome.exe', 'chrome-win/chrome.exe']) {
        const candidate = path.join(base, entry, rel);
        try { await fs.access(candidate); return candidate; } catch {}
      }
    }
  } catch {}
  return null;
}
