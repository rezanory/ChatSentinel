import crypto from 'node:crypto';

const LOOPBACKS = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

export function requestId(req) {
  const incoming = req.headers['x-request-id'];
  if (typeof incoming === 'string' && /^[A-Za-z0-9._-]{8,128}$/.test(incoming)) return incoming;
  return crypto.randomUUID();
}

export function setCors(req, res, { testMode = false } = {}) {
  const origin = req.headers.origin;
  if (typeof origin === 'string' && allowedCorsOrigin(origin, testMode)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Headers', 'content-type,x-chatsentinel-client,x-request-id');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Max-Age', '600');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'no-store');
}

export async function authorizeRequest(req, store, { testMode = false } = {}) {
  const address = normalizeAddress(req.socket.remoteAddress);
  if (!LOOPBACKS.has(address)) return { ok: false, status: 403, reason: 'non-loopback-client' };

  const origin = req.headers.origin;
  if (!origin) return { ok: true, client: 'local-process' };

  if (testMode && origin.startsWith('chrome-extension://')) {
    return { ok: true, client: 'test-extension', origin };
  }

  if (!origin.startsWith('chrome-extension://')) {
    return { ok: false, status: 403, reason: 'browser-origin-not-allowed' };
  }

  if (req.headers['x-chatsentinel-client'] !== 'extension') {
    return { ok: false, status: 403, reason: 'extension-client-header-required' };
  }

  const trusted = store.meta.trustedExtensionOrigin;
  if (!trusted) {
    store.setMeta('trustedExtensionOrigin', origin);
    await store.saveNow();
    return { ok: true, client: 'extension', origin, paired: true };
  }
  if (trusted !== origin) {
    return { ok: false, status: 403, reason: 'extension-origin-mismatch' };
  }
  return { ok: true, client: 'extension', origin };
}

export function createRateLimiter({ limitPerMinute = 600 } = {}) {
  const buckets = new Map();
  return function rateLimit(req) {
    const now = Date.now();
    const windowId = Math.floor(now / 60_000);
    const key = `${normalizeAddress(req.socket.remoteAddress)}|${req.headers.origin || 'local'}`;
    const current = buckets.get(key);
    const bucket = !current || current.windowId !== windowId
      ? { windowId, count: 0 }
      : current;
    bucket.count += 1;
    buckets.set(key, bucket);
    if (buckets.size > 500) {
      for (const [bucketKey, value] of buckets) {
        if (value.windowId < windowId) buckets.delete(bucketKey);
      }
    }
    return {
      ok: bucket.count <= limitPerMinute,
      remaining: Math.max(0, limitPerMinute - bucket.count),
      resetAt: (windowId + 1) * 60_000
    };
  };
}

function allowedCorsOrigin(origin, testMode) {
  if (origin.startsWith('chrome-extension://')) return true;
  return testMode && /^http:\/\/127\.0\.0\.1:\d+$/.test(origin);
}

function normalizeAddress(value = '') {
  return value === '::ffff:127.0.0.1' ? value : String(value);
}
