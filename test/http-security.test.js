import test from 'node:test';
import assert from 'node:assert/strict';
import { authorizeRequest, createRateLimiter } from '../src/http-security.js';

function req(headers = {}, remoteAddress = '127.0.0.1') {
  return { headers, socket: { remoteAddress } };
}

function store() {
  const state = { meta: {} };
  return {
    meta: state.meta,
    setMeta(key, value) { state.meta[key] = value; },
    async saveNow() {}
  };
}

test('local process without browser origin is allowed', async () => {
  const result = await authorizeRequest(req(), store());
  assert.equal(result.ok, true);
  assert.equal(result.client, 'local-process');
});

test('non-loopback client is rejected', async () => {
  const result = await authorizeRequest(req({}, '10.1.2.3'), store());
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'non-loopback-client');
});

test('first extension origin pairs and a different extension is rejected', async () => {
  const s = store();
  const first = await authorizeRequest(req({ origin: 'chrome-extension://aaa', 'x-chatsentinel-client': 'extension' }), s);
  assert.equal(first.ok, true);
  assert.equal(s.meta.trustedExtensionOrigin, 'chrome-extension://aaa');
  const other = await authorizeRequest(req({ origin: 'chrome-extension://bbb', 'x-chatsentinel-client': 'extension' }), s);
  assert.equal(other.ok, false);
  assert.equal(other.reason, 'extension-origin-mismatch');
});

test('browser origin without extension identity is rejected', async () => {
  const result = await authorizeRequest(req({ origin: 'https://chatgpt.com' }), store());
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'browser-origin-not-allowed');
});

test('rate limiter isolates buckets and enforces configured ceiling', () => {
  const limit = createRateLimiter({ limitPerMinute: 2 });
  const r = req({ origin: 'chrome-extension://aaa' });
  assert.equal(limit(r).ok, true);
  assert.equal(limit(r).ok, true);
  assert.equal(limit(r).ok, false);
  const other = req({ origin: 'chrome-extension://bbb' });
  assert.equal(limit(other).ok, true);
});
