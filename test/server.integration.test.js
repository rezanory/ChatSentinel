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
