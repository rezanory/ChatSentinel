import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createWatchdogServer } from '../src/server.js';

async function testConfig() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'chatsentinel-server-'));
  return {
    dir,
    config: {
      version: 'test',
      host: '127.0.0.1',
      port: 0,
      dataDir: dir,
      stateFile: path.join(dir, 'data', 'state.json'),
      logDir: path.join(dir, 'logs'),
      sessionTtlMs: 86_400_000,
      maxSessions: 100,
      maxBodyBytes: 65_536,
      rateLimitPerMinute: 1000,
      testMode: true
    }
  };
}

async function listen(app) {
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  const address = app.server.address();
  return `http://127.0.0.1:${address.port}`;
}

test('server persists config/session and restores them after restart', async t => {
  const { dir, config } = await testConfig();
  t.after(() => fs.rm(dir, { recursive: true, force: true }));

  let app = await createWatchdogServer(config);
  let base = await listen(app);
  let response = await fetch(`${base}/conversation/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ conversationId: 'chat-prod', operationClass: 'read_only' })
  });
  assert.equal(response.status, 200);

  response = await fetch(`${base}/signal`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ conversationId: 'chat-prod', retryVisible: true, state: 'IDLE' })
  });
  const decision = await response.json();
  assert.equal(decision.decision.action, 'SAFE_RETRY');
  await app.close();

  app = await createWatchdogServer(config);
  base = await listen(app);
  const supervisor = await fetch(`${base}/supervisor`).then(r => r.json());
  assert.equal(supervisor.count, 1);
  assert.equal(supervisor.sessions[0].id, 'chat-prod');
  const health = await fetch(`${base}/health`).then(r => r.json());
  assert.equal(health.conversations, 1);
  await app.close();
});

test('server rejects unsafe browser origins and invalid content type', async t => {
  const { dir, config } = await testConfig();
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const app = await createWatchdogServer(config);
  const base = await listen(app);

  let response = await fetch(`${base}/health`, { headers: { origin: 'https://example.com' } });
  assert.equal(response.status, 403);

  response = await fetch(`${base}/signal`, {
    method: 'POST',
    headers: { 'content-type': 'text/plain' },
    body: '{}'
  });
  assert.equal(response.status, 415);
  const body = await response.json();
  assert.equal(body.error, 'content-type-json-required');
  await app.close();
});

test('server pairs first extension origin in production mode', async t => {
  const { dir, config } = await testConfig();
  config.testMode = false;
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const app = await createWatchdogServer(config);
  const base = await listen(app);
  const headers = { origin: 'chrome-extension://prod123', 'x-chatsentinel-client': 'extension' };
  let response = await fetch(`${base}/health`, { headers });
  assert.equal(response.status, 200);
  response = await fetch(`${base}/health`, {
    headers: { origin: 'chrome-extension://evil999', 'x-chatsentinel-client': 'extension' }
  });
  assert.equal(response.status, 403);
  await app.close();
});

test('local process can reset extension pairing safely', async t => {
  const { dir, config } = await testConfig();
  config.testMode = false;
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const app = await createWatchdogServer(config);
  const base = await listen(app);

  let response = await fetch(`${base}/health`, {
    headers: { origin: 'chrome-extension://first', 'x-chatsentinel-client': 'extension' }
  });
  assert.equal(response.status, 200);
  response = await fetch(`${base}/admin/reset-pairing`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}'
  });
  assert.equal(response.status, 200);
  response = await fetch(`${base}/health`, {
    headers: { origin: 'chrome-extension://second', 'x-chatsentinel-client': 'extension' }
  });
  assert.equal(response.status, 200);
  await app.close();
});

test('multi-project registry isolates parallel chat groups and persists them', async t => {
  const { dir, config } = await testConfig();
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  let app = await createWatchdogServer(config);
  let base = await listen(app);

  const post = async (route, body) => {
    const response = await fetch(`${base}${route}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body)
    });
    const json = await response.json();
    assert.equal(response.status, 200, `${route}: ${JSON.stringify(json)}`);
    return json;
  };

  const alpha = (await post('/projects/upsert', {
    name: 'Alpha', projectPath: dir, operationClass: 'read_only', autoRecovery: true, groupTabs: true, color: 'blue'
  })).project;
  const beta = (await post('/projects/upsert', {
    name: 'Beta', projectPath: dir, operationClass: 'write', autoRecovery: false, groupTabs: true, color: 'red'
  })).project;

  await post('/projects/attach', { projectId: alpha.projectId, conversationId: 'alpha-1', tabId: 11, title: 'Alpha lane 1', url: 'https://chatgpt.com/' });
  await post('/projects/attach', { projectId: alpha.projectId, conversationId: 'alpha-2', tabId: 12, title: 'Alpha lane 2', url: 'https://chatgpt.com/' });
  await post('/projects/attach', { projectId: beta.projectId, conversationId: 'beta-1', tabId: 21, title: 'Beta lane 1', url: 'https://chatgpt.com/' });

  const alphaDecision = await post('/signal', { conversationId: 'alpha-1', retryVisible: true, state: 'IDLE', tabId: 11 });
  assert.equal(alphaDecision.projectId, alpha.projectId);
  assert.equal(alphaDecision.decision.action, 'SAFE_RETRY');
  assert.equal(alphaDecision.project.autoRecovery, true);

  const betaDecision = await post('/signal', { conversationId: 'beta-1', retryVisible: true, state: 'IDLE', tabId: 21 });
  assert.equal(betaDecision.projectId, beta.projectId);
  assert.notEqual(betaDecision.decision.action, 'SAFE_RETRY');

  let projects = await fetch(`${base}/projects`).then(r => r.json());
  const alphaRow = projects.projects.find(row => row.projectId === alpha.projectId);
  const betaRow = projects.projects.find(row => row.projectId === beta.projectId);
  assert.equal(alphaRow.chatCount, 2);
  assert.equal(betaRow.chatCount, 1);
  assert.deepEqual(alphaRow.chats.map(chat => chat.conversationId).sort(), ['alpha-1', 'alpha-2']);
  assert.deepEqual(betaRow.chats.map(chat => chat.conversationId), ['beta-1']);

  await app.close();
  app = await createWatchdogServer(config);
  base = await listen(app);
  projects = await fetch(`${base}/projects`).then(r => r.json());
  assert.equal(projects.projects.length, 2);
  assert.equal(projects.projects.find(row => row.projectId === alpha.projectId).chatCount, 2);
  assert.equal(projects.projects.find(row => row.projectId === beta.projectId).chatCount, 1);

  const context = await fetch(`${base}/project/context?conversationId=alpha-2`).then(r => r.json());
  assert.equal(context.project.projectId, alpha.projectId);
  assert.equal(context.config.tabId, 12);
  await app.close();
});

test('durable command API supports enqueue claim progress and completion', async t => {
  const { dir, config } = await testConfig();
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const app = await createWatchdogServer(config);
  const base = await listen(app);

  let response = await fetch(`${base}/commands/enqueue`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      type: 'CREATE_LANE_CHAT',
      idempotencyKey: 'lane:c1',
      payload: { projectId: 'project:test', prompt: 'seed lane', laneId: 'C1' }
    })
  });
  assert.equal(response.status, 200);
  const queued = await response.json();
  assert.equal(queued.command.status, 'pending');

  response = await fetch(`${base}/commands/claim`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ workerId: 'extension:test', leaseMs: 10000 })
  });
  const claimed = await response.json();
  assert.equal(claimed.command.commandId, queued.command.commandId);
  assert.equal(claimed.command.status, 'running');

  response = await fetch(`${base}/commands/progress`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ commandId: claimed.command.commandId, workerId: 'extension:test', progress: { tabId: 99 } })
  });
  assert.equal(response.status, 200);

  response = await fetch(`${base}/commands/complete`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ commandId: claimed.command.commandId, outcome: 'succeeded', result: { tabId: 99 } })
  });
  assert.equal(response.status, 200);
  const completed = await response.json();
  assert.equal(completed.command.status, 'succeeded');

  const list = await fetch(`${base}/commands`).then(r => r.json());
  assert.equal(list.count, 1);
  assert.equal(list.commands[0].result.tabId, 99);
  await app.close();
});

test('browser extension cannot enqueue privileged supervisor commands directly', async t => {
  const { dir, config } = await testConfig();
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const app = await createWatchdogServer(config);
  const base = await listen(app);
  const response = await fetch(`${base}/commands/enqueue`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      origin: 'chrome-extension://test',
      'x-chatsentinel-client': 'extension'
    },
    body: JSON.stringify({ type: 'GROUP_PROJECT_TABS', payload: { projectId: 'project:test' } })
  });
  assert.equal(response.status, 403);
  await app.close();
});

test('search and portable import/export routes enforce preview-before-apply', async t => {
  const { dir, config } = await testConfig();
  t.after(() => fs.rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }));
  const app = await createWatchdogServer(config);
  const base = await listen(app);
  const post = async (route, body, expected = 200) => {
    const response = await fetch(`${base}${route}`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body)
    });
    const json = await response.json();
    assert.equal(response.status, expected, `${route}: ${JSON.stringify(json)}`);
    return json;
  };

  const project = (await post('/projects/upsert', {
    name: 'Portable Alpha', projectPath: dir, operationClass: 'read_only', autoRecovery: true, color: 'green'
  })).project;
  await post('/projects/attach', { projectId: project.projectId, conversationId: 'portable-chat', title: 'Needle search title', tabId: 44 });
  await post('/signal', { conversationId: 'portable-chat', state: 'RUNNING', tabId: 44 });

  const search = await fetch(`${base}/search?query=needle&projectId=${encodeURIComponent(project.projectId)}&state=RUNNING`).then(r => r.json());
  assert.equal(search.count, 1);
  assert.equal(search.results[0].conversationId, 'portable-chat');

  const exported = await fetch(`${base}/portable/export?projectId=${encodeURIComponent(project.projectId)}`).then(r => r.json());
  assert.equal(exported.bundle.projects.length, 1);
  assert.equal(exported.bundle.recoverySnapshots['portable-chat'].state, 'RUNNING');
  const preview = await post('/portable/import/preview', { bundle: exported.bundle });
  assert.equal(preview.preview.projectsUpdate, 1);
  const rejected = await post('/portable/import/apply', { bundle: exported.bundle }, 400);
  assert.equal(rejected.error, 'preview-token-required');
  const applied = await post('/portable/import/apply', { bundle: exported.bundle, previewToken: preview.previewToken, applyRecoverySnapshots: true });
  assert.equal(applied.ok, true);
  await app.close();
});
