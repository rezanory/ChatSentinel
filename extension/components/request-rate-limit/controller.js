(() => {
  const STATE_KEY = 'chatsentinel:request-rate-limit:state';
  const LAST_REQUEST_KEY = 'chatsentinel:request-rate-limit:last-request-at';
  const MAX_LEVEL = 4;
  const INCIDENT_DEDUPE_MS = 60_000;
  const DECAY_WINDOW_MS = 10 * 60_000;
  const LEVEL_COOLDOWN_MS = Object.freeze([0, 120_000, 240_000, 480_000, 900_000]);
  const LEVEL_GAP_MS = Object.freeze([0, 10_000, 20_000, 30_000, 45_000]);
  const RATE_LIMIT_PATTERNS = Object.freeze([
    /too many requests/i,
    /you(?:'|’)?re making requests too quickly/i,
    /temporarily limited access to your conversations/i,
    /please wait a few minutes before trying again/i
  ]);
  const DISMISS_PATTERNS = Object.freeze([
    /^got it$/i,
    /^ok(?:ay)?$/i,
    /^dismiss$/i,
    /^close$/i,
    /^understood$/i
  ]);
  let lastDismissed = { key: '', at: 0 };

  function inspect(root = globalThis.document) {
    if (!root) return inactive('document-unavailable');
    const containers = modalContainers(root);
    for (const container of containers) {
      const text = normalizedText(container);
      if (!isRateLimitText(text)) continue;
      const button = findDismissButton(container);
      return activeObservation(container, text, button);
    }
    return inactive('rate-limit-ui-not-present');
  }

  function dismiss(root = globalThis.document, now = Date.now()) {
    const observation = inspect(root);
    if (!observation.active) return { ...observation, dismissed: false };
    if (!observation.dismissButton) {
      return { ...observation, dismissed: false, reason: 'rate-limit-dismiss-button-not-found' };
    }
    if (lastDismissed.key === observation.incidentKey && now - lastDismissed.at < 5000) {
      return { ...observation, dismissed: false, deduplicated: true, reason: 'rate-limit-dismiss-deduplicated' };
    }
    observation.dismissButton.click();
    lastDismissed = { key: observation.incidentKey, at: now };
    return { ...observation, dismissed: true, reason: 'rate-limit-dismissed' };
  }

  async function recordRateLimit(storage, incidentKey, nowFn = Date.now) {
    requireStorage(storage);
    const now = Number(nowFn());
    const stored = await storage.get(STATE_KEY);
    const previous = normalizeState(stored?.[STATE_KEY], now);
    if (previous.lastIncidentKey === incidentKey && (now < previous.cooldownUntil || now - previous.lastIncidentAt < INCIDENT_DEDUPE_MS)) {
      return { ...previous, duplicate: true };
    }
    const level = Math.min(MAX_LEVEL, Math.max(1, previous.level + 1));
    const next = {
      level,
      cooldownUntil: now + LEVEL_COOLDOWN_MS[level],
      lastRateLimitAt: now,
      lastIncidentAt: now,
      lastIncidentKey: String(incidentKey || 'rate-limit'),
      lastDecayAt: now
    };
    await storage.set({ [STATE_KEY]: next });
    return next;
  }

  async function noteHealthy(storage, nowFn = Date.now) {
    requireStorage(storage);
    const now = Number(nowFn());
    const stored = await storage.get(STATE_KEY);
    const previous = normalizeState(stored?.[STATE_KEY], now);
    if (previous.level <= 0) return previous;
    const anchor = Math.max(previous.lastRateLimitAt, previous.lastDecayAt);
    if (now - anchor < DECAY_WINDOW_MS) return previous;
    const nextLevel = Math.max(0, previous.level - 1);
    const next = {
      ...previous,
      level: nextLevel,
      cooldownUntil: Math.min(previous.cooldownUntil, now),
      lastDecayAt: now
    };
    if (nextLevel === 0) {
      next.lastIncidentKey = '';
      next.lastIncidentAt = 0;
    }
    await storage.set({ [STATE_KEY]: next });
    return next;
  }

  async function gate(storage, nowFn = Date.now) {
    requireStorage(storage);
    const now = Number(nowFn());
    const stored = await storage.get([STATE_KEY, LAST_REQUEST_KEY]);
    const state = normalizeState(stored?.[STATE_KEY], now);
    const lastRequestAt = Math.max(0, Number(stored?.[LAST_REQUEST_KEY] || 0));
    const cooldownWaitMs = Math.max(0, state.cooldownUntil - now);
    const minGapMs = LEVEL_GAP_MS[state.level] || 0;
    const gapWaitMs = Math.max(0, lastRequestAt + minGapMs - now);
    const waitMs = Math.max(cooldownWaitMs, gapWaitMs);
    return {
      allowed: waitMs <= 0,
      waitMs,
      level: state.level,
      minGapMs,
      cooldownUntil: state.cooldownUntil,
      batchLimit: batchLimit(state.level)
    };
  }

  async function markRequest(storage, nowFn = Date.now) {
    requireStorage(storage);
    const at = Number(nowFn());
    await storage.set({ [LAST_REQUEST_KEY]: at });
    return at;
  }

  function batchLimit(level, normalMax = 6) {
    const normalized = Math.max(0, Math.min(MAX_LEVEL, Number(level || 0)));
    if (normalized <= 0) return Math.max(1, Number(normalMax || 6));
    if (normalized === 1) return Math.min(2, Math.max(1, Number(normalMax || 6)));
    return 1;
  }

  function normalizeState(value, now = Date.now()) {
    const state = value && typeof value === 'object' ? value : {};
    const level = Math.max(0, Math.min(MAX_LEVEL, Number(state.level || 0)));
    return {
      level,
      cooldownUntil: Math.max(0, Number(state.cooldownUntil || 0)),
      lastRateLimitAt: Math.max(0, Number(state.lastRateLimitAt || 0)),
      lastIncidentAt: Math.max(0, Number(state.lastIncidentAt || 0)),
      lastIncidentKey: String(state.lastIncidentKey || ''),
      lastDecayAt: Math.max(0, Number(state.lastDecayAt || state.lastRateLimitAt || now))
    };
  }

  function modalContainers(root) {
    const selectors = '[role="dialog"], [role="alertdialog"], [aria-modal="true"], [data-radix-dialog-content], [role="alert"]';
    const rows = [...(root.querySelectorAll?.(selectors) || [])];
    return rows.length ? rows : [];
  }

  function findDismissButton(root) {
    const buttons = [...(root?.querySelectorAll?.('button') || [])];
    return buttons.find(button => {
      if (button.disabled || !isVisible(button)) return false;
      const label = String(button.innerText || button.textContent || button.getAttribute?.('aria-label') || '').trim();
      return DISMISS_PATTERNS.some(pattern => pattern.test(label));
    }) || null;
  }

  function activeObservation(container, text, button) {
    const relevant = RATE_LIMIT_PATTERNS.filter(pattern => pattern.test(text)).map(pattern => pattern.source).join('|');
    const incidentKey = 'rate:' + simpleHash(relevant + ':' + text.slice(0, 800));
    return {
      active: true,
      reason: 'chatgpt-too-many-requests',
      incidentKey,
      dismissButton: button,
      dismissLabel: button ? String(button.innerText || button.textContent || button.getAttribute?.('aria-label') || '').trim() : '',
      container
    };
  }

  function inactive(reason) {
    return { active: false, reason, incidentKey: '', dismissButton: null, dismissLabel: '', container: null };
  }

  function isRateLimitText(text) {
    return RATE_LIMIT_PATTERNS.some(pattern => pattern.test(String(text || '')));
  }

  function normalizedText(node) {
    return String(node?.innerText || node?.textContent || '').replace(/\s+/g, ' ').trim();
  }

  function isVisible(element) {
    if (!element) return false;
    if (typeof element.getBoundingClientRect !== 'function' || typeof globalThis.getComputedStyle !== 'function') return true;
    const rect = element.getBoundingClientRect();
    const style = globalThis.getComputedStyle(element);
    return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
  }

  function requireStorage(storage) {
    if (!storage?.get || !storage?.set) throw new TypeError('rate-limit-storage-required');
  }

  function simpleHash(value) {
    let hash = 2166136261;
    for (const character of String(value || '')) {
      hash ^= character.charCodeAt(0);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(36);
  }

  globalThis.ChatSentinelRequestRateLimit = Object.freeze({
    STATE_KEY,
    LAST_REQUEST_KEY,
    MAX_LEVEL,
    INCIDENT_DEDUPE_MS,
    DECAY_WINDOW_MS,
    LEVEL_COOLDOWN_MS,
    LEVEL_GAP_MS,
    RATE_LIMIT_PATTERNS,
    DISMISS_PATTERNS,
    inspect,
    dismiss,
    recordRateLimit,
    noteHealthy,
    gate,
    markRequest,
    batchLimit,
    normalizeState
  });
})();
