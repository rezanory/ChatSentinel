import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { decideRecovery } from './recovery-engine.js';
import { reconcileProject } from './project-reconciler.js';
import { startHeartbeat } from './heartbeat.js';
import { classifySideEffectRisk, isFreshCheckpoint } from './side-effect-classifier.js';
import { StateStore } from './state-store.js';
import { createLogger } from './logger.js';
import { authorizeRequest, createRateLimiter, requestId, setCors } from './http-security.js';
import { validateConversationConfig, validateProject, validateProjectAttach, validateReconcileRequest, validateSignal } from './validation.js';
import { appendAuditEvent, listAuditEvents } from './audit-history.js';
import { buildProjectTree } from './project-tree.js';

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
      projects: Object.keys(store.projects).length,
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

  if (req.method === 'GET' && url.pathname === '/projects') {
    return json(res, 200, { ok: true, projects: projectRows(store) });
  }

  if (req.method === 'GET' && url.pathname === '/projects/tree') {
    const projects = projectRows(store);
    return json(res, 200, { ok: true, tree: buildProjectTree(projects), projects });
  }

  if (req.method === 'GET' && url.pathname === '/audit/history') {
    const projectId = String(url.searchParams.get('projectId') || '').trim() || undefined;
    const limit = Number(url.searchParams.get('limit') || 200);
    return json(res, 200, { ok: true, events: listAuditEvents(store, { projectId, limit }) });
  }

  if (req.method === 'GET' && url.pathname === '/project/context') {
    const conversationId = String(url.searchParams.get('conversationId') || '').trim();
    if (!conversationId) return json(res, 400, { ok: false, error: 'conversationId-required' });
    const configRow = store.getConfig(conversationId);
    const project = configRow.projectId ? store.getProject(configRow.projectId) : null;
    return json(res, 200, {
      ok: true,
      conversationId,
      config: configRow,
      project,
      session: store.getSession(conversationId),
      projects: projectRows(store)
    });
  }

  if (req.method === 'POST' && url.pathname === '/projects/upsert') {
    const body = await readJson(req, config.maxBodyBytes);
    const parsed = validateProject(body);
    if (!parsed.ok) return json(res, 400, { ok: false, error: parsed.error, requestId: id });
    const projectId = parsed.value.projectId || `project:${randomUUID()}`;
    const existing = store.getProject(projectId) || {};
    const now = new Date().toISOString();
    const project = { ...existing, ...parsed.value, projectId, createdAt: existing.createdAt || now, updatedAt: now };
    await store.setProject(projectId, project);
    appendAuditEvent(store, { type: 'action', action: existing.projectId ? 'PROJECT_UPDATED' : 'PROJECT_CREATED', outcome: 'success', projectId, projectName: project.name });
    logger.info('project-upserted', { projectId, name: project.name, projectPath: project.projectPath });
    return json(res, 200, { ok: true, project, projects: projectRows(store) });
  }

  if (req.method === 'GET' && (url.pathname === '/sessions' || url.pathname === '/supervisor')) {
    const rows = supervisorRows(store.sessions);
    return json(res, 200, { count: rows.length, sessions: rows });
  }

  if (req.method === 'POST' && url.pathname === '/projects/attach') {
    const body = await readJson(req, config.maxBodyBytes);
    const parsed = validateProjectAttach(body);
    if (!parsed.ok) return json(res, 400, { ok: false, error: parsed.error, requestId: id });
    const project = store.getProject(parsed.value.projectId);
    if (!project) return json(res, 404, { ok: false, error: 'project-not-found', requestId: id });
    const existing = store.getConfig(parsed.value.conversationId);
    const next = {
      ...existing,
      ...parsed.value,
      projectId: project.projectId,
      projectPath: project.projectPath,
      operationClass: existing.operationClass || ''
    };
    await store.setConfig(parsed.value.conversationId, next);
    appendAuditEvent(store, { type: 'action', action: 'CHAT_ATTACHED', outcome: 'success', projectId: project.projectId, projectName: project.name, conversationId: parsed.value.conversationId });
    logger.info('conversation-attached', { projectId: project.projectId, conversationId: parsed.value.conversationId, tabId: parsed.value.tabId });
    return json(res, 200, { ok: true, project, config: next, projects: projectRows(store) });
  }

  if (req.method === 'POST' && url.pathname === '/projects/detach') {
    const body = await readJson(req, config.maxBodyBytes);
    const conversationId = String(body?.conversationId || '').trim();
    if (!conversationId) return json(res, 400, { ok: false, error: 'conversationId-required', requestId: id });
    const existing = store.getConfig(conversationId);
    if (body?.forget === true) {
      await store.deleteConfig(conversationId);
      logger.info('conversation-forgotten', { conversationId });
      return json(res, 200, { ok: true, config: {}, projects: projectRows(store) });
    }
    const next = { ...existing };
    delete next.projectId;
    delete next.projectPath;
    await store.setConfig(conversationId, next);
    appendAuditEvent(store, { type: 'action', action: 'CHAT_DETACHED', outcome: 'success', projectId: existing.projectId, conversationId });
    logger.info('conversation-detached', { conversationId });
    return json(res, 200, { ok: true, config: next, projects: projectRows(store) });
  }

  if (req.method === 'POST' && url.pathname === '/projects/delete') {
    const body = await readJson(req, config.maxBodyBytes);
    const projectId = String(body?.projectId || '').trim();
    if (!projectId) return json(res, 400, { ok: false, error: 'projectId-required', requestId: id });
    if (!store.getProject(projectId)) return json(res, 404, { ok: false, error: 'project-not-found', requestId: id });
    const deletedProject = store.getProject(projectId);
    await store.deleteProject(projectId);
    appendAuditEvent(store, { type: 'action', action: 'PROJECT_DELETED', outcome: 'success', projectId, projectName: deletedProject?.name });
    logger.warn('project-deleted', { projectId });
    return json(res, 200, { ok: true, projects: projectRows(store) });
  }

  if (req.method === 'POST' && (url.pathname === '/conversation/register' || url.pathname === '/project/register')) {
    const body = await readJson(req, config.maxBodyBytes);
    const parsed = validateConversationConfig(body);
    if (!parsed.ok) return json(res, 400, { ok: false, error: parsed.error, requestId: id });
    const { conversationId, projectId, projectPath, operationClass, tabId, title, url: conversationUrl } = parsed.value;
    const existing = store.getConfig(conversationId);
    const linkedProject = projectId ? store.getProject(projectId) : null;
    if (projectId && !linkedProject) return json(res, 404, { ok: false, error: 'project-not-found', requestId: id });
    const next = {
      ...existing,
      ...(projectId ? { projectId } : {}),
      ...(linkedProject?.projectPath ? { projectPath: linkedProject.projectPath } : projectPath ? { projectPath } : {}),
      ...(operationClass !== undefined ? { operationClass } : linkedProject?.operationClass !== undefined ? { operationClass: linkedProject.operationClass } : {}),
      ...(tabId !== undefined ? { tabId } : {}),
      ...(title ? { title } : {}),
      ...(conversationUrl ? { url: conversationUrl } : {})
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
    const project = current.projectId ? store.getProject(current.projectId) : null;
    const projectPath = parsed.value.projectPath || project?.projectPath || current.projectPath;
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

  const metadataChanged = (signal.tabId !== undefined && signal.tabId !== config.tabId) ||
    (signal.title && signal.title !== config.title) ||
    (signal.url && signal.url !== config.url);
  if (signal.projectPath || signal.operationClass !== undefined || metadataChanged) {
    config = {
      ...config,
      ...(signal.projectPath ? { projectPath: signal.projectPath } : {}),
      ...(signal.operationClass !== undefined ? { operationClass: signal.operationClass } : {}),
      ...(signal.tabId !== undefined ? { tabId: signal.tabId } : {}),
      ...(signal.title ? { title: signal.title } : {}),
      ...(signal.url ? { url: signal.url } : {})
    };
    await store.setConfig(id, config);
  }

  const project = config.projectId ? store.getProject(config.projectId) : null;
  const projectPath = project?.projectPath || config.projectPath;
  const effectiveOperationClass = config.operationClass !== undefined && config.operationClass !== ''
    ? config.operationClass
    : (project?.operationClass || config.operationClass);
  const reconciliation = projectPath ? await reconcileProject(projectPath) : null;
  const checkpointFresh = projectPath
    ? isFreshCheckpoint(reconciliation)
    : Boolean(signal.checkpointFresh);
  const sideEffectRisk = classifySideEffectRisk({ signal, reconciliation, previous, policy: { ...project, ...config, operationClass: effectiveOperationClass } });

  const merged = {
    ...previous,
    ...signal,
    projectPath,
    projectId: config.projectId,
    projectName: project?.name,
    operationClass: effectiveOperationClass,
    autoRecovery: project?.autoRecovery,
    reconciliation,
    checkpointFresh,
    sideEffectRisk,
    updatedAt: new Date().toISOString()
  };

  const decision = decideRecovery(merged);
  const record = { ...merged, decision };
  store.setSession(id, record);
  appendAuditEvent(store, { type: 'recovery', action: decision.action, outcome: 'decided', projectId: config.projectId, projectName: project?.name, conversationId: id, reason: decision.reason });
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
    projectId: config.projectId,
    project: project || null,
    projectPath,
    sideEffectRisk,
    checkpointFresh
  });
}

function projectRows(store) {
  return Object.values(store.projects)
    .map(project => {
      const chats = Object.entries(store.configs)
        .filter(([, config]) => config?.projectId === project.projectId)
        .map(([conversationId, config]) => {
          const session = store.getSession(conversationId);
          return {
            conversationId,
            tabId: config.tabId,
            title: config.title,
            url: config.url,
            operationClass: config.operationClass,
            state: session.state,
            decision: session.decision,
            updatedAt: session.updatedAt,
            checkpointFresh: session.checkpointFresh,
            sideEffectRisk: session.sideEffectRisk
          };
        });
      return { ...project, chats, chatCount: chats.length };
    })
    .sort((a, b) => String(a.name).localeCompare(String(b.name)));
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
    projectId: row.projectId,
    projectName: row.projectName,
    projectPath: row.projectPath,
    operationClass: row.operationClass,
    autoRecovery: row.autoRecovery,
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
