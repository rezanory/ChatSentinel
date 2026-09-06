import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';

const execFileAsync = promisify(execFile);

const ROOT = path.resolve('.');
const PORT = 4319;
const BASE = `http://127.0.0.1:${PORT}`;
const dataDir = path.join(os.tmpdir(), `chatsentinel-prod-smoke-${process.pid}`);
const projectDir = path.join(dataDir, 'project');
const originDir = path.join(dataDir, 'origin.git');
let child;

try {
  await createCleanGitFixture();
  child = startWatchdog();
  await waitHealth();
  const project = (await post('/projects/upsert', {
    name: 'Production Smoke', projectPath: projectDir, operationClass: 'read_only',
    autoRecovery: true, groupTabs: true, color: 'blue'
  })).project;
  await post('/projects/attach', {
    projectId: project.projectId, conversationId: 'prod-smoke', tabId: 101,
    title: 'Production smoke chat', url: 'https://chatgpt.com/'
  });
  const first = await post('/signal', { conversationId: 'prod-smoke', retryVisible: true, state: 'IDLE', tabId: 101 });
  assert.equal(first.projectId, project.projectId);
  assert.equal(first.decision.action, 'SAFE_RETRY');

  let rejected = await fetch(`${BASE}/health`, { headers: { origin: 'https://example.com' } });
  assert.equal(rejected.status, 403);
  rejected = await fetch(`${BASE}/signal`, { method: 'POST', headers: { 'content-type': 'text/plain' }, body: '{}' });
  assert.equal(rejected.status, 415);

  // Session telemetry is debounced to cap disk writes; production RPO is <=300ms.
  await sleep(500);
  child.kill();
  await waitExit(child);
  child = startWatchdog();
  const health = await waitHealth();
  assert.equal(health.version, '1.3.4');
  const supervisor = await fetch(`${BASE}/supervisor`).then(r => r.json());
  assert.equal(supervisor.sessions.some(row => row.id === 'prod-smoke'), true);
  const projects = await fetch(`${BASE}/projects`).then(r => r.json());
  assert.equal(projects.projects.length, 1);
  assert.equal(projects.projects[0].name, 'Production Smoke');
  assert.equal(projects.projects[0].chatCount, 1);
  assert.equal(projects.projects[0].chats[0].conversationId, 'prod-smoke');

  const stateFile = path.join(dataDir, 'data', 'state.json');
  const logFile = path.join(dataDir, 'logs', 'watchdog.jsonl');
  await fs.access(stateFile);
  await fs.access(logFile);
  const logText = await fs.readFile(logFile, 'utf8');
  assert.match(logText, /recovery-decision/);
  console.log('ChatSentinel production smoke: PASS');
} finally {
  child?.kill();
  await fs.rm(dataDir, { recursive: true, force: true }).catch(() => {});
}

async function createCleanGitFixture() {
  await fs.mkdir(dataDir, { recursive: true });
  await fs.mkdir(projectDir, { recursive: true });
  await fs.writeFile(path.join(projectDir, 'README.md'), '# production smoke\n', 'utf8');
  await git(projectDir, ['init', '-b', 'main']);
  await git(projectDir, ['config', 'user.name', 'ChatSentinel Smoke']);
  await git(projectDir, ['config', 'user.email', 'smoke@localhost']);
  await git(projectDir, ['add', 'README.md']);
  await git(projectDir, ['commit', '-m', 'smoke baseline']);
  await fs.mkdir(originDir, { recursive: true });
  await git(originDir, ['init', '--bare']);
  await git(projectDir, ['remote', 'add', 'origin', originDir]);
  await git(projectDir, ['push', '-u', 'origin', 'main']);
}

async function git(cwd, args) {
  await execFileAsync('git', ['-C', cwd, ...args], { windowsHide: true, timeout: 15000 });
}

function startWatchdog() {
  return spawn(process.execPath, ['src/local-watchdog.js'], {
    cwd: ROOT,
    stdio: 'ignore',
    env: {
      ...process.env,
      CHATSENTINEL_PORT: String(PORT),
      CHATSENTINEL_DATA_DIR: dataDir,
      CHATSENTINEL_TEST_MODE: '1'
    }
  });
}

async function waitHealth() {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${BASE}/health`);
      if (response.ok) return await response.json();
    } catch {}
    await sleep(150);
  }
  throw new Error('watchdog health timeout');
}

async function post(route, body) {
  const response = await fetch(`${BASE}${route}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  });
  const result = await response.json();
  if (!response.ok) throw new Error(`${route}: ${JSON.stringify(result)}`);
  return result;
}

function waitExit(process) {
  if (process.exitCode !== null) return Promise.resolve();
  return new Promise(resolve => process.once('exit', resolve));
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
