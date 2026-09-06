const DEFAULT_LIMIT = 200;
const MAX_HISTORY = 500;

export function isRoutineRecoveryEvent(event) {
  return String(event?.type || '').trim().toLowerCase() === 'recovery'
    && String(event?.action || '').trim().toUpperCase() === 'WAIT'
    && String(event?.reason || '').trim().toLowerCase() === 'no-recovery-needed';
}

export function appendAuditEvent(store, event, now = new Date()) {
  const rawHistory = Array.isArray(store.meta.auditHistory) ? store.meta.auditHistory : [];
  const history = rawHistory.filter(row => !isRoutineRecoveryEvent(row));
  if (isRoutineRecoveryEvent(event)) {
    if (history.length !== rawHistory.length) store.setMeta('auditHistory', history.slice(-MAX_HISTORY));
    return null;
  }
  const row = {
    id: `${now.getTime()}:${history.length}`,
    at: now.toISOString(),
    type: clean(event.type, 40) || 'action',
    action: clean(event.action, 80) || 'unknown',
    outcome: clean(event.outcome, 40) || 'recorded',
    projectId: clean(event.projectId, 120) || undefined,
    projectName: clean(event.projectName, 120) || undefined,
    conversationId: clean(event.conversationId, 200) || undefined,
    reason: clean(event.reason, 300) || undefined
  };
  store.setMeta('auditHistory', [...history, row].slice(-MAX_HISTORY));
  return row;
}

export function listAuditEvents(store, { projectId, limit = DEFAULT_LIMIT } = {}) {
  const rows = (Array.isArray(store.meta.auditHistory) ? store.meta.auditHistory : [])
    .filter(row => !isRoutineRecoveryEvent(row));
  const bounded = Math.max(1, Math.min(Number(limit) || DEFAULT_LIMIT, MAX_HISTORY));
  return rows
    .filter(row => !projectId || row.projectId === projectId)
    .slice(-bounded)
    .reverse();
}

function clean(value, max) {
  if (value === undefined || value === null) return '';
  const text = String(value).trim();
  return text.length <= max ? text : text.slice(0, max);
}
