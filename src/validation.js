const OPERATION_CLASSES = new Set([
  'read', 'read_only', 'readonly', 'inspect', 'search', 'query',
  'write', 'mutate', 'deploy', 'commit', 'push', 'delete', ''
]);
const TAB_COLORS = new Set(['grey', 'blue', 'red', 'yellow', 'green', 'pink', 'purple', 'cyan', 'orange']);

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
    connectionInterrupted: Boolean(body.connectionInterrupted),
    conversationDead: Boolean(body.conversationDead),
    uiFrozen: Boolean(body.uiFrozen),
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
    url: body.url === undefined ? undefined : cleanString(body.url, 4096)
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
