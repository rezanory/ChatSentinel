import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';

const ROOT = path.resolve('.');
const CHROME = process.env.CHROME_BIN || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const extension = path.join(ROOT, 'extension');
const RUN = `e2e-${process.pid}-${Date.now()}`;
const profile = path.join(os.tmpdir(), `chatsentinel-e2e-${process.pid}`);
const fixture = spawn(process.execPath, ['scripts/e2e/fault-fixture-server.js'], {
  cwd: ROOT,
  stdio: 'ignore'
});
let chrome;

try {
  await waitUrl('http://127.0.0.1:4320/idle');
  const health = await waitJson('http://127.0.0.1:4317/health');
  assert.equal(health.version, '0.3.0', 'v0.3 watchdog must be running');

  chrome = spawn(CHROME, [
    `--user-data-dir=${profile}`,
    '--remote-debugging-port=9223',
    `--disable-extensions-except=${extension}`,
    `--load-extension=${extension}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-sync',
    'http://127.0.0.1:4320/idle'
  ], { stdio: 'ignore' });

  await waitJson('http://127.0.0.1:9223/json/version');
  await detectorSuite();
  await actuatorSuite();
  console.log('ChatSentinel browser E2E: PASS');
} finally {
  chrome?.kill();
  fixture.kill();
  await fs.rm(profile, { recursive: true, force: true }).catch(() => {});
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
  const retryTarget = await openPage(`http://127.0.0.1:4320/retry?auto=1&cid=${encodeURIComponent(`${RUN}-retry-auto`)}`);
  await waitEval(retryTarget, "document.body.dataset.retryClicked === '1'");
  console.log('SAFE_RETRY actuator: PASS');

  await postJson('/conversation/register', {
    conversationId: `${RUN}-interrupt-auto`,
    projectPath: ROOT,
    operationClass: 'write'
  });
  const continueTarget = await openPage(`http://127.0.0.1:4320/interrupt?auto=1&cid=${encodeURIComponent(`${RUN}-interrupt-auto`)}`);
  await waitEval(continueTarget, "Boolean(document.body.dataset.sent)");
  const sent = await evalValue(continueTarget, 'document.body.dataset.sent');
  assert.match(sent, /reconcile|checkpoint|SHA/i);
  console.log('CONTINUE_SAME_CHAT actuator: PASS');

  const deadId = `${RUN}-dead-auto`;
  const deadTarget = await openPage(`http://127.0.0.1:4320/dead?auto=1&cid=${encodeURIComponent(deadId)}`);
  await waitEval(deadTarget, "location.pathname === '/newchat' && Boolean(document.body.dataset.sent)");
  const handoff = await evalValue(deadTarget, 'document.body.dataset.sent');
  assert.match(handoff, /checkpoint|source-of-truth|ادامه پروژه/i);
  console.log('CONTINUE_NEW_CHAT + handoff actuator: PASS');
}
async function verifyDecision(kind, expectedAction) {
  const id = `${RUN}-${kind}`;
  await openPage(`http://127.0.0.1:4320/${kind}?cid=${encodeURIComponent(id)}`);
  const row = await waitForSession(id);
  assert.equal(row.decision?.action, expectedAction, `${kind} decision`);
  console.log(`${kind}: ${row.decision.action} PASS`);
}

async function openPage(url) {
  const encoded = encodeURIComponent(url);
  const res = await fetch(`http://127.0.0.1:9223/json/new?${encoded}`, { method: 'PUT' });
  if (!res.ok) throw new Error(`cannot open ${url}: ${res.status}`);
  return await res.json();
}

async function waitForSession(id) {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    const state = await fetch('http://127.0.0.1:4317/supervisor').then(r => r.json());
    const row = state.sessions?.find(item => item.id === id);
    if (row?.decision) return row;
    await sleep(250);
  }
  throw new Error(`session ${id} not observed`);
}

async function postJson(route, body) {
  const res = await fetch(`http://127.0.0.1:4317${route}`, {
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
    const targets = await waitJson('http://127.0.0.1:9223/json/list');
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
