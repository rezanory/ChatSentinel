const OPERATION_CLASSES = new Set([
  'read', 'read_only', 'readonly', 'inspect', 'search', 'query',
  'write', 'mutate', 'deploy', 'commit', 'push', 'delete', ''
]);
const TAB_COLORS = new Set(['grey', 'blue', 'red', 'yellow', 'green', 'pink', 'purple', 'cyan', 'orange']);
const COMMAND_TYPES = new Set(['CREATE_LANE_CHAT', 'SEND_PROMPT', 'GROUP_PROJECT_TABS', 'FOCUS_CHAT', 'RELOAD_CHAT', 'CLOSE_CHAT', 'REPLACE_CHAT']);

export function validateConversationConfig(body) {
  if (!isRecord(body)) return invalid('json-object-required');
  const conversationId = cleanString(body.conversationId, 200);
  if (!conversationId) return invalid('conversationId-required');
  const projectPath = body.projectPath === undefined ? undefined : cleanString(body.projectPath, 2048);
  if (body.projectPath !== undefined && !projectPath) return invalid('projectPath-invalid');
  const operationClass = body.operationClass === undefined
    ? undefined
    : cleanString(body.operationClass, 40).toLowerCase();
  if (operationClass !== undefined && !OPERATION_CLASSES.has(operationClass)) {
    return invalid('operationClass-invalid');
  }
  const projectId = body.projectId === undefined ? undefined : cleanString(body.projectId, 120);
  const tabId = body.tabId === undefined ? undefined : finiteNumber(body.tabId, 0, 2 ** 31 - 1);
  const title = body.title === undefined ? undefined : cleanString(body.title, 300);
  const url = body.url === undefined ? undefined : cleanString(body.url, 4096);
  return { ok: true, value: { conversationId, projectId, projectPath, operationClass, tabId, title, url } };
}

export function validateSignal(body) {
  if (!isRecord(body)) return invalid('json-object-required');
  const conversationId = cleanString(body.conversationId || body.tabId || 'unknown', 200);
  const state = cleanString(body.state || 'UNKNOWN', 40).toUpperCase();
  const value = {
    ...body,
    conversationId,
    state,
    progressAgeMs: finiteNumber(body.progressAgeMs, 0, 7 * 24 * 60 * 60 * 1000),
    retryCount: finiteNumber(body.retryCount, 0, 100),
    retryVisible: Boolean(body.retryVisible),
    messageDeliveryTimedOut: Boolean(body.messageDeliveryTimedOut),
    messageDeliveryRetryCount: finiteNumber(body.messageDeliveryRetryCount, 0, 10),
    connectionInterrupted: Boolean(body.connectionInterrupted),
    conversationDead: Boolean(body.conversationDead),
    uiFrozen: Boolean(body.uiFrozen),
    genericUiFailure: Boolean(body.genericUiFailure),
    pageCrashed: Boolean(body.pageCrashed),
    workSelected: Boolean(body.workSelected),
    workModeCorrected: Boolean(body.workModeCorrected),
    lastAssistantText: cleanString(body.lastAssistantText || '', 2200),
    lastAssistantFingerprint: cleanString(body.lastAssistantFingerprint || '', 120),
    assistantSettledMs: finiteNumber(body.assistantSettledMs, 0, 24 * 60 * 60 * 1000),
    externalActivity: Boolean(body.externalActivity)
  };
  if (body.projectId !== undefined) value.projectId = cleanString(body.projectId, 120);
  if (body.projectPath !== undefined) value.projectPath = cleanString(body.projectPath, 2048);
  if (body.tabId !== undefined) value.tabId = finiteNumber(body.tabId, 0, 2 ** 31 - 1);
  if (body.title !== undefined) value.title = cleanString(body.title, 300);
  if (body.url !== undefined) value.url = cleanString(body.url, 4096);
  if (body.operationClass !== undefined) {
    value.operationClass = cleanString(body.operationClass, 40).toLowerCase();
    if (!OPERATION_CLASSES.has(value.operationClass)) return invalid('operationClass-invalid');
  }
  return { ok: true, value };
}

export function validateProject(body) {
  if (!isRecord(body)) return invalid('json-object-required');
  const projectId = body.projectId === undefined ? undefined : cleanString(body.projectId, 120);
  const name = cleanString(body.name, 120);
  const projectPath = cleanString(body.projectPath, 2048);
  if (!name) return invalid('project-name-required');
  if (!projectPath) return invalid('projectPath-required');
  const operationClass = cleanString(body.operationClass || '', 40).toLowerCase();
  if (!OPERATION_CLASSES.has(operationClass)) return invalid('operationClass-invalid');
  const color = cleanString(body.color || 'blue', 20).toLowerCase();
  if (!TAB_COLORS.has(color)) return invalid('color-invalid');
  const folderPath = body.folderPath === undefined ? '' : cleanString(body.folderPath, 600);
  if (body.folderPath !== undefined && String(body.folderPath).trim() && !folderPath) return invalid('folderPath-invalid');
  return { ok: true, value: {
    projectId,
    name,
    projectPath,
    folderPath,
    operationClass,
    autoRecovery: Boolean(body.autoRecovery),
    groupTabs: body.groupTabs !== false,
    color
  } };
}

export function validateProjectAttach(body) {
  if (!isRecord(body)) return invalid('json-object-required');
  const projectId = cleanString(body.projectId, 120);
  const conversationId = cleanString(body.conversationId, 200);
  if (!projectId) return invalid('projectId-required');
  if (!conversationId) return invalid('conversationId-required');
  return { ok: true, value: {
    projectId,
    conversationId,
    tabId: body.tabId === undefined ? undefined : finiteNumber(body.tabId, 0, 2 ** 31 - 1),
    title: body.title === undefined ? undefined : cleanString(body.title, 300),
    url: body.url === undefined ? undefined : cleanString(body.url, 4096),
    laneId: body.laneId === undefined ? undefined : cleanString(body.laneId, 100),
    laneName: body.laneName === undefined ? undefined : cleanString(body.laneName, 160),
    branch: body.branch === undefined ? undefined : cleanString(body.branch, 240),
    baselineSha: body.baselineSha === undefined ? undefined : cleanString(body.baselineSha, 40),
    role: body.role === undefined ? undefined : cleanString(body.role, 120)
  } };
}

export function validateCommandEnqueue(body) {
  if (!isRecord(body)) return invalid('json-object-required');
  const type = cleanString(body.type, 80).toUpperCase();
  if (!COMMAND_TYPES.has(type)) return invalid('command-type-invalid');
  const payload = isRecord(body.payload) ? body.payload : {};
  const checked = validateCommandPayload(type, payload);
  if (!checked.ok) return checked;
  return { ok: true, value: {
    commandId: body.commandId === undefined ? undefined : cleanString(body.commandId, 160),
    type,
    payload: checked.value,
    idempotencyKey: body.idempotencyKey === undefined ? undefined : cleanString(body.idempotencyKey, 200),
    maxAttempts: body.maxAttempts === undefined ? 5 : finiteNumber(body.maxAttempts, 1, 10)
  } };
}

export function validateCommandClaim(body) {
  if (!isRecord(body)) return invalid('json-object-required');
  const workerId = cleanString(body.workerId, 160);
  if (!workerId) return invalid('workerId-required');
  const rawExcluded = body.excludeTypes === undefined ? [] : body.excludeTypes;
  if (!Array.isArray(rawExcluded) || rawExcluded.length > COMMAND_TYPES.size) return invalid('command-exclude-types-invalid');
  const excludeTypes = [...new Set(rawExcluded.map(value => cleanString(value, 80).toUpperCase()))];
  if (excludeTypes.some(type => !COMMAND_TYPES.has(type))) return invalid('command-exclude-types-invalid');
  return { ok: true, value: {
    workerId,
    leaseMs: finiteNumber(body.leaseMs ?? 60000, 5000, 120000),
    excludeTypes
  } };
}

export function validateCommandProgress(body) {
  if (!isRecord(body)) return invalid('json-object-required');
  const commandId = cleanString(body.commandId, 160);
  if (!commandId) return invalid('commandId-required');
  if (body.progress !== undefined && !isRecord(body.progress)) return invalid('command-progress-invalid');
  return { ok: true, value: {
    commandId,
    progress: body.progress || {},
    workerId: body.workerId === undefined ? undefined : cleanString(body.workerId, 160),
    leaseMs: finiteNumber(body.leaseMs ?? 60000, 5000, 120000)
  } };
}

export function validateCommandComplete(body) {
  if (!isRecord(body)) return invalid('json-object-required');
  const commandId = cleanString(body.commandId, 160);
  const outcome = cleanString(body.outcome, 20).toLowerCase();
  if (!commandId) return invalid('commandId-required');
  if (!['succeeded', 'retry', 'failed'].includes(outcome)) return invalid('command-outcome-invalid');
  return { ok: true, value: {
    commandId,
    outcome,
    result: isRecord(body.result) ? body.result : {},
    error: body.error === undefined ? undefined : cleanString(body.error, 1200),
    retryAfterMs: finiteNumber(body.retryAfterMs ?? 1000, 250, 60000)
  } };
}

function validateCommandPayload(type, payload) {
  const projectId = cleanString(payload.projectId, 120);
  const prompt = cleanString(payload.prompt, 30000);
  const conversationId = cleanString(payload.conversationId, 200);
  const tabId = payload.tabId === undefined ? undefined : finiteNumber(payload.tabId, 0, 2 ** 31 - 1);
  const targetRequired = ['SEND_PROMPT', 'FOCUS_CHAT', 'RELOAD_CHAT', 'CLOSE_CHAT', 'REPLACE_CHAT'].includes(type);
  if (targetRequired && !conversationId && tabId === undefined) return invalid('command-target-required');
  if (['CREATE_LANE_CHAT', 'GROUP_PROJECT_TABS', 'REPLACE_CHAT'].includes(type) && !projectId) return invalid('projectId-required');
  if (['CREATE_LANE_CHAT', 'SEND_PROMPT', 'REPLACE_CHAT'].includes(type) && !prompt) return invalid('command-prompt-required');
  const url = payload.url === undefined ? undefined : cleanString(payload.url, 4096);
  if (url && !/^https:\/\/chatgpt\.com\//i.test(url)) return invalid('command-url-invalid');
  return { ok: true, value: {
    projectId: projectId || undefined,
    prompt: prompt || undefined,
    conversationId: conversationId || undefined,
    tabId,
    url,
    laneId: payload.laneId === undefined ? undefined : cleanString(payload.laneId, 100),
    laneName: payload.laneName === undefined ? undefined : cleanString(payload.laneName, 160),
    branch: payload.branch === undefined ? undefined : cleanString(payload.branch, 240),
    baselineSha: payload.baselineSha === undefined ? undefined : cleanString(payload.baselineSha, 40),
    role: payload.role === undefined ? undefined : cleanString(payload.role, 120),
    closeOld: Boolean(payload.closeOld)
  } };
}

export function validateReconcileRequest(body) {
  if (!isRecord(body)) return invalid('json-object-required');
  const conversationId = body.conversationId === undefined ? undefined : cleanString(body.conversationId, 200);
  const projectPath = body.projectPath === undefined ? undefined : cleanString(body.projectPath, 2048);
  if (!conversationId && !projectPath) return invalid('conversationId-or-projectPath-required');
  return { ok: true, value: { conversationId, projectPath } };
}

function cleanString(value, max) {
  if (typeof value !== 'string' && typeof value !== 'number') return '';
  const text = String(value).trim();
  return text && text.length <= max ? text : '';
}

function finiteNumber(value, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return min;
  return Math.min(max, Math.max(min, number));
}

function isRecord(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function invalid(error) {
  return { ok: false, error };
}
