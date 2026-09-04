import http from 'node:http';
import { decideRecovery } from './recovery-engine.js';
import { reconcileProject } from './project-reconciler.js';
import { startHeartbeat } from './heartbeat.js';
import { classifySideEffectRisk, isFreshCheckpoint } from './side-effect-classifier.js';
import { StateStore } from './state-store.js';
import { createLogger } from './logger.js';
import { authorizeRequest, createRateLimiter, requestId, setCors } from './http-security.js';
import { validateConversationConfig, validateReconcileRequest, validateSignal } from './validation.js';

export async function createWatchdogServer(config) {
  const logger = createLogger({ dir: config.logDir });
  const store = new StateStore({
    file: config.stateFile,
    maxSessions: config.maxSessions,
    sessionTtlMs: config.sessionTtlMs,
    onError: error => logger.error('state-store-error', { error })
  });
  await store.load();
  const rateLimit = createRateLimiter({ limitPerMinute: config.rateLimitPerMinute });
  const heartbeat = startHeartbeat();
  const startedAt = Date.now();
  let ready = true;

  const server = http.createServer(async (req, res) => {
    const id = requestId(req);
    res.setHeader('X-Request-ID', id);
    setCors(req, res, config);

    try {
      if (req.method === 'OPTIONS') return end(res, 204);
      const limited = rateLimit(req);
      res.setHeader('X-RateLimit-Remaining', String(limited.remaining));
      if (!limited.ok) return json(res, 429, { ok: false, error: 'rate-limit-exceeded', requestId: id });

      const auth = await authorizeRequest(req, store, config);
      if (!auth.ok) {
        logger.warn('request-rejected', { requestId: id, reason: auth.reason, origin: req.headers.origin });
        return json(res, auth.status || 403, { ok: false, error: auth.reason, requestId: id });
      }

      return await route(req, res, { id, store, logger, config, heartbeat, startedAt, ready, auth });
    } catch (error) {
      logger.error('request-error', { requestId: id, error });
      return json(res, error.statusCode || 500, {
        ok: false,
        error: error.publicCode || 'internal-error',
        requestId: id
      });
    }
  });

  server.requestTimeout = 30_000;
  server.headersTimeout = 10_000;
  server.keepAliveTimeout = 5_000;
  server.maxHeadersCount = 50;
  server.maxConnections = 100;

  const cleanup = setInterval(() => {
    store.prune();
    store.scheduleSave(0);
  }, Math.min(config.sessionTtlMs, 60 * 60 * 1000));
  cleanup.unref?.();

  async function close() {
    ready = false;
    clearInterval(cleanup);
    heartbeat.stop();
    await store.flush().catch(error => logger.error('state-flush-failed', { error }));
    await new Promise(resolve => server.close(resolve));
    await logger.flush();
  }

  return { server, store, logger, heartbeat, close };
}

async function route(req, res, ctx) {
  const url = new URL(req.url, 'http://localhost');
  const { store, config, heartbeat, startedAt, logger, id } = ctx;

  if (req.method === 'GET' && url.pathname === '/health') {
    return json(res, 200, {
      ok: true,
      service: 'ChatSentinel',
      version: config.version,
      pid: process.pid,
      uptimeSec: Math.floor((Date.now() - startedAt) / 1000),
      sessions: Object.keys(store.sessions).length,
      conversations: Object.keys(store.configs).length,
      heartbeat: heartbeat.enabled,
      memoryRss: process.memoryUsage().rss,
      paired: Boolean(store.meta.trustedExtensionOrigin)
    });
  }

  if (req.method === 'GET' && url.pathname === '/ready') {
    return json(res, 200, { ok: true, ready: true, version: config.version });
  }

  if (req.method === 'POST' && url.pathname === '/admin/reset-pairing') {
    if (ctx.auth?.client !== 'local-process') {
      return json(res, 403, { ok: false, error: 'local-process-required', requestId: id });
    }
    delete store.meta.trustedExtensionOrigin;
    await store.saveNow();
    logger.warn('extension-pairing-reset', { requestId: id });
    return json(res, 200, { ok: true, paired: false });
  }

  if (req.method === 'GET' && (url.pathname === '/sessions' || url.pathname === '/supervisor')) {
    const rows = supervisorRows(store.sessions);
    return json(res, 200, { count: rows.length, sessions: rows });
  }

  if (req.method === 'POST' && (url.pathname === '/conversation/register' || url.pathname === '/project/register')) {
    const body = await readJson(req, config.maxBodyBytes);
    const parsed = validateConversationConfig(body);
    if (!parsed.ok) return json(res, 400, { ok: false, error: parsed.error, requestId: id });
    const { conversationId, projectPath, operationClass } = parsed.value;
    const existing = store.getConfig(conversationId);
    const next = {
      ...existing,
      ...(projectPath ? { projectPath } : {}),
      ...(operationClass !== undefined ? { operationClass } : {})
    };
    await store.setConfig(conversationId, next);
    const reconciliation = next.projectPath ? await reconcileProject(next.projectPath) : null;
    logger.info('conversation-configured', {
      conversationId,
      operationClass: next.operationClass,
      branch: reconciliation?.branch,
      head: reconciliation?.head
    });
    return json(res, reconciliation && !reconciliation.ok ? 422 : 200, {
      ok: !reconciliation || reconciliation.ok,
      config: next,
      reconciliation
    });
  }

  if (req.method === 'POST' && url.pathname === '/project/reconcile') {
    const body = await readJson(req, config.maxBodyBytes);
    const parsed = validateReconcileRequest(body);
    if (!parsed.ok) return json(res, 400, { ok: false, error: parsed.error, requestId: id });
    const current = parsed.value.conversationId ? store.getConfig(parsed.value.conversationId) : {};
    const projectPath = parsed.value.projectPath || current.projectPath;
    const reconciliation = await reconcileProject(projectPath);
    return json(res, reconciliation.ok ? 200 : 422, { ok: reconciliation.ok, reconciliation });
  }

  if (req.method === 'POST' && url.pathname === '/signal') {
    const body = await readJson(req, config.maxBodyBytes);
    const parsed = validateSignal(body);
    if (!parsed.ok) return json(res, 400, { ok: false, error: parsed.error, requestId: id });
    return handleSignal(res, parsed.value, ctx);
  }

  return json(res, 404, { ok: false, error: 'not-found', requestId: id });
}

async function handleSignal(res, signal, ctx) {
  const { store, logger } = ctx;
  const id = signal.conversationId;
  const previous = store.getSession(id);
  let config = store.getConfig(id);

  if (signal.projectPath || signal.operationClass !== undefined) {
    config = {
      ...config,
      ...(signal.projectPath ? { projectPath: signal.projectPath } : {}),
      ...(signal.operationClass !== undefined ? { operationClass: signal.operationClass } : {})
    };
    await store.setConfig(id, config);
  }

  const projectPath = config.projectPath;
  const reconciliation = projectPath ? await reconcileProject(projectPath) : null;
  const checkpointFresh = projectPath
    ? isFreshCheckpoint(reconciliation)
    : Boolean(signal.checkpointFresh);
  const sideEffectRisk = classifySideEffectRisk({ signal, reconciliation, previous, policy: config });

  const merged = {
    ...previous,
    ...signal,
    projectPath,
    operationClass: config.operationClass,
    reconciliation,
    checkpointFresh,
    sideEffectRisk,
    updatedAt: new Date().toISOString()
  };

  const decision = decideRecovery(merged);
  const record = { ...merged, decision };
  store.setSession(id, record);
  logger.info('recovery-decision', {
    conversationId: id,
    action: decision.action,
    reason: decision.reason,
    confidence: decision.confidence,
    sideEffectRisk,
    checkpointFresh,
    branch: reconciliation?.branch,
    head: reconciliation?.head,
    remoteHead: reconciliation?.remoteHead
  });

  return json(res, 200, {
    ok: true,
    decision,
    reconciliation,
    projectPath,
    sideEffectRisk,
    checkpointFresh
  });
}

function supervisorRows(sessions) {
  return Object.entries(sessions).map(([id, row]) => ({
    id,
    state: row.state,
    decision: row.decision,
    updatedAt: row.updatedAt,
    progressAgeMs: row.progressAgeMs,
    sideEffectRisk: row.sideEffectRisk,
    checkpointFresh: row.checkpointFresh,
    projectPath: row.projectPath,
    operationClass: row.operationClass,
    branch: row.reconciliation?.branch,
    head: row.reconciliation?.head,
    remoteHead: row.reconciliation?.remoteHead
  }));
}

function end(res, status) {
  res.statusCode = status;
  res.end();
}

function json(res, status, body) {
  if (res.writableEnded) return;
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(body));
}

function readJson(req, maxBytes) {
  if (!String(req.headers['content-type'] || '').toLowerCase().startsWith('application/json')) {
    return Promise.reject(httpError(415, 'content-type-json-required'));
  }
  return new Promise((resolve, reject) => {
    let body = '';
    let size = 0;
    req.setEncoding('utf8');
    req.on('data', chunk => {
      size += Buffer.byteLength(chunk);
      if (size > maxBytes) {
        reject(httpError(413, 'request-too-large'));
        req.destroy();
        return;
      }
      body += chunk;
    });
    req.on('end', () => {
      try { resolve(body ? JSON.parse(body) : {}); }
      catch { reject(httpError(400, 'invalid-json')); }
    });
    req.on('error', reject);
  });
}

function httpError(statusCode, publicCode) {
  const error = new Error(publicCode);
  error.statusCode = statusCode;
  error.publicCode = publicCode;
  return error;
}
