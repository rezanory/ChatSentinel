import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { decideRecovery } from './recovery-engine.js';
import { reconcileProject } from './project-reconciler.js';
import { startHeartbeat } from './heartbeat.js';
import { classifySideEffectRisk, isFreshCheckpoint } from './side-effect-classifier.js';
import { StateStore } from './state-store.js';
import { createLogger } from './logger.js';
import { authorizeRequest, createRateLimiter, requestId, setCors } from './http-security.js';
import { validateCommandClaim, validateCommandComplete, validateCommandEnqueue, validateCommandProgress, validateConversationConfig, validateProject, validateProjectAttach, validateReconcileRequest, validateSignal } from './validation.js';
import { cancelCommand, claimCommand, completeCommand, enqueueCommand, listCommands, updateCommandProgress } from './command-queue.js';
import { configureOrchestration, tickProjectOrchestration } from './components/project-orchestrator/controller.js';
import { activateFullProjectMode } from './components/full-project-mode/activation.js';
import { searchProjectChats } from './project-search.js';
import { applyPortableImport, createPortableBundle, previewPortableImport } from './portable-bundle.js';
import { appendAuditEvent, listAuditEvents } from './audit-history.js';
import { buildProjectTree } from './project-tree.js';
import { detectPrerequisites } from './components/setup/prerequisite-detector.js';
import { buildSetupPlan, applySetupPlan } from './components/setup/install-plan.js';
import { remoteDesktopCommanderStatus, recoverRemoteDesktopCommander } from './remote-desktop-commander-recovery.js';
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
  let orchestrationBusy = false;
  const orchestrationTimer = setInterval(async () => {
    if (orchestrationBusy) return;
    orchestrationBusy = true;
    try {
      for (const project of Object.values(store.projects)) {
        if (project?.orchestration?.enabled) await tickProjectOrchestration(store, project.projectId, { logger });
      }
    } catch (error) { logger.error('orchestrator-auto-tick-failed', { error }); }
    finally { orchestrationBusy = false; }
  }, 30000);
  orchestrationTimer.unref?.();

  async function close() {
    ready = false;
    clearInterval(cleanup);
    clearInterval(orchestrationTimer);
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


  if (req.method === 'GET' && url.pathname === '/recovery/remote-desktop-commander') {
    const result = await remoteDesktopCommanderStatus();
    return json(res, result.ok ? 200 : 503, result);
  }

  if (req.method === 'POST' && url.pathname === '/recovery/remote-desktop-commander') {
    const result = await recoverRemoteDesktopCommander();
    logger.info('remote-desktop-commander-recovery', {
      requestId: id,
      ok: result.ok,
      recovered: result.recovered,
      running: result.running,
      state: result.state,
      error: result.error
    });
    return json(res, result.ok ? 200 : 503, result);
  }

  if (req.method === 'GET' && url.pathname === '/setup/status') {
    const report = detectPrerequisites();
    return json(res, 200, { ...report, watchdog: { online: true, version: config.version, paired: Boolean(store.meta.trustedExtensionOrigin) } });
  }

  if (req.method === 'GET' && url.pathname === '/setup/plan') {
    const detected = detectPrerequisites();
    const report = { ...detected, watchdog: { online: true, version: config.version, paired: Boolean(store.meta.trustedExtensionOrigin) } };
    const includeWatchdogService = url.searchParams.get('service') === '1';
    const plan = buildSetupPlan(report, { root: process.cwd(), includeRecommended: true, includeWatchdogService });
    return json(res, plan.ok ? 200 : 400, { ...plan, report });
  }

  if (req.method === 'POST' && url.pathname === '/setup/apply') {
    if (ctx.auth?.client !== 'local-process') return json(res, 403, { ok: false, error: 'local-process-required', requestId: id });
    const body = await readJson(req, config.maxBodyBytes);
    const report = detectPrerequisites();
    const plan = buildSetupPlan(report, { root: process.cwd(), includeRecommended: true, includeWatchdogService: Boolean(body?.includeWatchdogService) });
    const result = await applySetupPlan(plan, { approvedStepIds: Array.isArray(body?.approvedStepIds) ? body.approvedStepIds : [], dryRun: body?.execute !== true, cwd: process.cwd() });
    logger.info('setup-plan-applied', { requestId: id, execute: body?.execute === true, approvedStepIds: body?.approvedStepIds || [], ok: result.ok });
    return json(res, result.ok ? 200 : 500, result);
  }

  if (req.method === 'GET' && url.pathname === '/commands') {
    const status = String(url.searchParams.get('status') || '').trim().toLowerCase() || undefined;
    const limit = Number(url.searchParams.get('limit') || 100);
    const commands = listCommands(store, { status, limit });
    return json(res, 200, { ok: true, count: commands.length, commands });
  }

  if (req.method === 'POST' && url.pathname === '/commands/enqueue') {
    if (ctx.auth?.client !== 'local-process') {
      return json(res, 403, { ok: false, error: 'local-process-required', requestId: id });
    }
    const body = await readJson(req, config.maxBodyBytes);
    const parsed = validateCommandEnqueue(body);
    if (!parsed.ok) return json(res, 400, { ok: false, error: parsed.error, requestId: id });
    const queued = await enqueueCommand(store, parsed.value);
    logger.info('command-enqueued', { commandId: queued.command.commandId, type: queued.command.type, deduplicated: queued.deduplicated });
    return json(res, 200, { ok: true, ...queued });
  }

  if (req.method === 'POST' && url.pathname === '/commands/claim') {
    const body = await readJson(req, config.maxBodyBytes);
    const parsed = validateCommandClaim(body);
    if (!parsed.ok) return json(res, 400, { ok: false, error: parsed.error, requestId: id });
    const command = await claimCommand(store, parsed.value);
    if (command) logger.info('command-claimed', { commandId: command.commandId, type: command.type, workerId: parsed.value.workerId, attempt: command.attempts });
    return json(res, 200, { ok: true, command });
  }

  if (req.method === 'POST' && url.pathname === '/commands/progress') {
    const body = await readJson(req, config.maxBodyBytes);
    const parsed = validateCommandProgress(body);
    if (!parsed.ok) return json(res, 400, { ok: false, error: parsed.error, requestId: id });
    const command = await updateCommandProgress(store, parsed.value);
    if (!command) return json(res, 404, { ok: false, error: 'command-not-found', requestId: id });
    return json(res, 200, { ok: true, command });
  }

  if (req.method === 'POST' && url.pathname === '/commands/complete') {
    const body = await readJson(req, config.maxBodyBytes);
    const parsed = validateCommandComplete(body);
    if (!parsed.ok) return json(res, 400, { ok: false, error: parsed.error, requestId: id });
    const command = await completeCommand(store, parsed.value);
    if (!command) return json(res, 404, { ok: false, error: 'command-not-found', requestId: id });
    logger.info('command-completed', { commandId: command.commandId, type: command.type, status: command.status, attempts: command.attempts });
    return json(res, 200, { ok: true, command });
  }

  if (req.method === 'POST' && url.pathname === '/commands/cancel') {
    if (ctx.auth?.client !== 'local-process') {
      return json(res, 403, { ok: false, error: 'local-process-required', requestId: id });
    }
    const body = await readJson(req, config.maxBodyBytes);
    const commandId = String(body?.commandId || '').trim();
    if (!commandId) return json(res, 400, { ok: false, error: 'commandId-required', requestId: id });
    const command = await cancelCommand(store, commandId);
    if (!command) return json(res, 404, { ok: false, error: 'command-not-found', requestId: id });
    return json(res, 200, { ok: true, command });
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

  if (req.method === 'POST' && url.pathname === '/full-project-mode/activate') {
    const body = await readJson(req, config.maxBodyBytes);
    const result = await activateFullProjectMode(store, body);
    if (result.ok) {
      appendAuditEvent(store, { type: 'action', action: 'FULL_PROJECT_MODE_ACTIVATED', outcome: 'success', projectId: result.project.projectId, projectName: result.project.name, conversationId: result.config?.conversationId || body?.conversationId });
      logger.info('full-project-mode-activated', { projectId: result.project.projectId, conversationId: body?.conversationId, created: result.created });
    }
    return json(res, result.ok ? 200 : 400, result);
  }

  if (req.method === 'POST' && url.pathname === '/orchestrator/configure') {
    if (ctx.auth?.client !== 'local-process') return json(res, 403, { ok: false, error: 'local-process-required', requestId: id });
    const body = await readJson(req, config.maxBodyBytes);
    const projectId = String(body?.projectId || '').trim();
    if (!projectId) return json(res, 400, { ok: false, error: 'projectId-required', requestId: id });
    const result = await configureOrchestration(store, projectId, body);
    return json(res, result.ok ? 200 : 400, result);
  }

  if (req.method === 'POST' && url.pathname === '/orchestrator/tick') {
    if (ctx.auth?.client !== 'local-process') return json(res, 403, { ok: false, error: 'local-process-required', requestId: id });
    const body = await readJson(req, config.maxBodyBytes);
    const projectId = String(body?.projectId || '').trim();
    if (!projectId) return json(res, 400, { ok: false, error: 'projectId-required', requestId: id });
    const result = await tickProjectOrchestration(store, projectId, { logger });
    return json(res, 200, result);
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
      operationClass: existing.operationClass || '',
      attachedAt: new Date().toISOString()
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

  if (req.method === 'GET' && url.pathname === '/search') {
    const result = searchProjectChats(store, Object.fromEntries(url.searchParams.entries()));
    return json(res, result.ok ? 200 : 400, result);
  }

  if (req.method === 'GET' && url.pathname === '/portable/export') {
    const projectIds = url.searchParams.getAll('projectId');
    const bundle = createPortableBundle(store, {
      projectIds,
      includeRecoverySnapshots: url.searchParams.get('includeRecoverySnapshots') !== 'false'
    });
    return json(res, 200, { ok: true, bundle });
  }

  if (req.method === 'POST' && url.pathname === '/portable/import/preview') {
    const body = await readJson(req, config.maxBodyBytes);
    const result = previewPortableImport(store, body?.bundle);
    return json(res, result.ok ? 200 : 400, result);
  }

  if (req.method === 'POST' && url.pathname === '/portable/import/apply') {
    const body = await readJson(req, config.maxBodyBytes);
    const result = await applyPortableImport(store, body?.bundle, {
      previewToken: body?.previewToken,
      applyRecoverySnapshots: body?.applyRecoverySnapshots === true
    });
    if (result.ok) logger.info('portable-import-applied', result.applied);
    return json(res, result.ok ? 200 : 400, result);
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
  const auditEvent = appendAuditEvent(store, { type: 'recovery', action: decision.action, outcome: 'decided', projectId: config.projectId, projectName: project?.name, conversationId: id, reason: decision.reason });
  const record = { ...merged, decision };
  store.setSession(id, record);
  if (auditEvent) logger.info('recovery-decision', {
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
            laneId: config.laneId,
            laneName: config.laneName,
            branch: config.branch,
            baselineSha: config.baselineSha,
            role: config.role,
            attachedAt: config.attachedAt,
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
