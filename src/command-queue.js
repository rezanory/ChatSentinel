import crypto from 'node:crypto';

const TERMINAL = new Set(['succeeded', 'failed', 'cancelled']);
const COMMAND_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_COMMANDS = 1000;

export async function enqueueCommand(store, input) {
  pruneCommands(store);
  if (input.idempotencyKey) {
    const existing = Object.values(store.commands).find(row =>
      row.idempotencyKey === input.idempotencyKey && !['failed', 'cancelled'].includes(row.status));
    if (existing) return { command: existing, deduplicated: true };
  }

  const now = new Date().toISOString();
  const commandId = input.commandId || `cmd:${crypto.randomUUID()}`;
  const command = {
    commandId,
    type: input.type,
    payload: input.payload || {},
    idempotencyKey: input.idempotencyKey,
    status: 'pending',
    attempts: 0,
    maxAttempts: input.maxAttempts || 5,
    notBefore: now,
    progress: {},
    createdAt: now,
    updatedAt: now
  };
  store.state.commands[commandId] = command;
  await store.saveNow();
  return { command, deduplicated: false };
}

export async function claimCommand(store, { workerId, leaseMs = 60000 }) {
  pruneCommands(store);
  const nowMs = Date.now();
  const candidates = Object.values(store.commands)
    .filter(command => isClaimable(command, nowMs))
    .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
  const command = candidates[0];
  if (!command) return null;

  command.status = 'running';
  command.workerId = workerId;
  command.attempts = Number(command.attempts || 0) + 1;
  command.leaseUntil = new Date(nowMs + leaseMs).toISOString();
  command.updatedAt = new Date(nowMs).toISOString();
  await store.saveNow();
  return command;
}

export async function updateCommandProgress(store, { commandId, progress, leaseMs = 60000, workerId }) {
  const command = store.commands[commandId];
  if (!command || TERMINAL.has(command.status)) return null;
  command.progress = { ...(command.progress || {}), ...(progress || {}) };
  if (workerId) command.workerId = workerId;
  command.leaseUntil = new Date(Date.now() + leaseMs).toISOString();
  command.updatedAt = new Date().toISOString();
  await store.saveNow();
  return command;
}

export async function completeCommand(store, { commandId, outcome, result, error, retryAfterMs = 1000 }) {
  const command = store.commands[commandId];
  if (!command) return null;
  const now = new Date();

  if (outcome === 'retry' && Number(command.attempts || 0) < Number(command.maxAttempts || 5)) {
    command.status = 'pending';
    command.notBefore = new Date(now.getTime() + retryAfterMs).toISOString();
    command.lastError = error || 'retry-requested';
    delete command.leaseUntil;
    delete command.workerId;
  } else if (outcome === 'succeeded') {
    command.status = 'succeeded';
    command.result = result || {};
    command.completedAt = now.toISOString();
    delete command.leaseUntil;
  } else {
    command.status = 'failed';
    command.lastError = error || 'command-failed';
    command.result = result || {};
    command.completedAt = now.toISOString();
    delete command.leaseUntil;
  }
  command.updatedAt = now.toISOString();
  await store.saveNow();
  return command;
}

export async function cancelCommand(store, commandId) {
  const command = store.commands[commandId];
  if (!command || TERMINAL.has(command.status)) return command || null;
  command.status = 'cancelled';
  command.completedAt = new Date().toISOString();
  command.updatedAt = command.completedAt;
  delete command.leaseUntil;
  await store.saveNow();
  return command;
}

export function listCommands(store, { status, limit = 100 } = {}) {
  pruneCommands(store);
  return Object.values(store.commands)
    .filter(command => !status || command.status === status)
    .sort((a, b) => Date.parse(b.updatedAt || b.createdAt) - Date.parse(a.updatedAt || a.createdAt))
    .slice(0, Math.max(1, Math.min(500, Number(limit) || 100)));
}

function isClaimable(command, nowMs) {
  if (!command || TERMINAL.has(command.status)) return false;
  const notBefore = Date.parse(command.notBefore || command.createdAt || 0);
  if (Number.isFinite(notBefore) && notBefore > nowMs) return false;
  if (command.status === 'pending') return Number(command.attempts || 0) < Number(command.maxAttempts || 5);
  if (command.status !== 'running') return false;
  const lease = Date.parse(command.leaseUntil || 0);
  return !Number.isFinite(lease) || lease <= nowMs;
}

export function pruneCommands(store, now = Date.now()) {
  const rows = Object.entries(store.commands || {});
  for (const [id, command] of rows) {
    if (!TERMINAL.has(command?.status)) continue;
    const updated = Date.parse(command.updatedAt || command.completedAt || command.createdAt || '');
    if (Number.isFinite(updated) && now - updated > COMMAND_TTL_MS) delete store.state.commands[id];
  }
  const remaining = Object.entries(store.commands || {});
  if (remaining.length <= MAX_COMMANDS) return;
  remaining.sort((a, b) => Date.parse(a[1]?.updatedAt || 0) - Date.parse(b[1]?.updatedAt || 0));
  const removable = remaining.filter(([, command]) => TERMINAL.has(command?.status));
  for (const [id] of removable.slice(0, Math.max(0, remaining.length - MAX_COMMANDS))) {
    delete store.state.commands[id];
  }
}
