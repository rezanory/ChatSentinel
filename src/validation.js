const OPERATION_CLASSES = new Set([
  'read', 'read_only', 'readonly', 'inspect', 'search', 'query',
  'write', 'mutate', 'deploy', 'commit', 'push', 'delete', ''
]);

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
  return { ok: true, value: { conversationId, projectPath, operationClass } };
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
  if (body.projectPath !== undefined) value.projectPath = cleanString(body.projectPath, 2048);
  if (body.operationClass !== undefined) {
    value.operationClass = cleanString(body.operationClass, 40).toLowerCase();
    if (!OPERATION_CLASSES.has(value.operationClass)) return invalid('operationClass-invalid');
  }
  return { ok: true, value };
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
