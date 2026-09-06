(() => {
  const DEFAULT_WORKER_IDLE_MS = 10 * 60 * 1000;
  const DEFAULT_JUDGE_IDLE_MS = 4 * 60 * 1000;
  const MIN_IDLE_MS = 60 * 1000;

  function roleOf(chat = {}) {
    return String(chat.role || '').trim().toLowerCase();
  }

  function isJudge(chat = {}) {
    const role = roleOf(chat);
    return role === 'judge' || role === 'supervisor' || role === 'adjudicator';
  }

  function idleThreshold(chat = {}, options = {}) {
    const requested = isJudge(chat)
      ? Number(options.judgeIdleMs || DEFAULT_JUDGE_IDLE_MS)
      : Number(options.workerIdleMs || DEFAULT_WORKER_IDLE_MS);
    return Math.max(MIN_IDLE_MS, requested);
  }

  function safeToDiscard({ tab = {}, chat = {}, now = Date.now(), options = {} } = {}) {
    if (!Number.isInteger(Number(tab.id))) return { allowed: false, reason: 'tab-id-missing' };
    if (tab.active) return { allowed: false, reason: 'tab-active' };
    if (tab.audible) return { allowed: false, reason: 'tab-audible' };
    if (tab.discarded) return { allowed: false, reason: 'already-discarded' };
    if (String(chat.state || '').toUpperCase() === 'RUNNING') return { allowed: false, reason: 'chat-running' };
    const recovery = String(chat.decision?.action || '');
    if (recovery && recovery !== 'WAIT') return { allowed: false, reason: 'recovery-pending' };
    const lastAccessed = Number(tab.lastAccessed || 0);
    if (!lastAccessed) return { allowed: false, reason: 'last-access-unknown' };
    const idleMs = Math.max(0, Number(now) - lastAccessed);
    const thresholdMs = idleThreshold(chat, options);
    if (idleMs < thresholdMs) return { allowed: false, reason: 'idle-threshold-not-reached', idleMs, thresholdMs };
    return { allowed: true, reason: isJudge(chat) ? 'judge-idle-renderer-reset' : 'worker-idle-renderer-reset', idleMs, thresholdMs };
  }
  function shouldCloseCompletedWorker({ chat = {}, completion = {} } = {}) {
    if (isJudge(chat)) return { allowed: false, reason: 'judge-preserved' };
    if (!completion?.complete) return { allowed: false, reason: 'completion-not-canonical' };
    if (!completion?.head) return { allowed: false, reason: 'completion-head-missing' };
    return { allowed: true, reason: 'canonical-worker-complete' };
  }

  function needsRevive(tab = {}) {
    return Boolean(tab?.discarded);
  }

  globalThis.ChatSentinelTabResourceHygiene = Object.freeze({
    DEFAULT_WORKER_IDLE_MS,
    DEFAULT_JUDGE_IDLE_MS,
    MIN_IDLE_MS,
    roleOf,
    isJudge,
    idleThreshold,
    safeToDiscard,
    shouldCloseCompletedWorker,
    needsRevive
  });
})();
