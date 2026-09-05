(() => {
  const CHATGPT_HOME = 'https://chatgpt.com/';
  const HOME_ORIGIN = new URL(CHATGPT_HOME).origin;
  const LAST_LAUNCH_KEY = 'chatsentinel:tab-launch:last-at';
  const DEFAULT_MIN_LAUNCH_GAP_MS = 6000;
  const DEFAULT_PAGE_SETTLE_MS = 1500;
  const MAX_REPLACEMENTS = 2;
  const MAX_RATE_LIMIT_RECHECKS = 3;
  const CRASH_RECOVERY_PREFIX = 'chatsentinel:tab-crash-recovery:';
  const CRASH_RECOVERY_WINDOW_MS = 5 * 60 * 1000;
  const CRASH_URL_PREFIXES = Object.freeze([
    'chrome-error://',
    'edge-error://',
    'about:crash'
  ]);
  const CRASH_PATTERNS = Object.freeze([
    /this page is having a problem/i,
    /aw, snap/i,
    /page (?:is )?unresponsive/i,
    /page crashed/i,
    /status_(?:access_violation|breakpoint|stack_buffer_overrun)/i,
    /result_code_(?:hung|crashed|killed|killed_bad_message)/i,
    /out of memory/i,
    /not enough memory/i
  ]);
  const RATE_LIMIT_PATTERNS = Object.freeze([
    /too many requests/i,
    /you(?:'|’)?re making requests too quickly/i,
    /temporarily limited access to your conversations/i,
    /please wait a few minutes before trying again/i
  ]);

  function safeNewChatUrl(_candidate) {
    return CHATGPT_HOME;
  }

  function safeExistingChatUrl(candidate) {
    try {
      const url = new URL(String(candidate || CHATGPT_HOME));
      if (url.origin !== HOME_ORIGIN) return CHATGPT_HOME;
      const path = /^\/c\/[A-Za-z0-9_-]+/.test(url.pathname) ? url.pathname : '';
      return path ? HOME_ORIGIN + path : CHATGPT_HOME;
    } catch {
      return CHATGPT_HOME;
    }
  }

  function containsPromptInUrl(candidate) {
    return /[?&](?:prompt|prompt-textarea|message|text)=/i.test(String(candidate || ''));
  }

  function pacingDelay(lastLaunchAt, now = Date.now(), minGapMs = DEFAULT_MIN_LAUNCH_GAP_MS) {
    const last = Math.max(0, Number(lastLaunchAt || 0));
    const gap = Math.max(1000, Number(minGapMs || DEFAULT_MIN_LAUNCH_GAP_MS));
    return Math.max(0, last + gap - Number(now || 0));
  }

  async function acquireLaunchSlot(storage, sleepFn = defaultSleep, nowFn = Date.now, minGapMs = DEFAULT_MIN_LAUNCH_GAP_MS) {
    if (!storage?.get || !storage?.set) throw new TypeError('tab-launch-storage-required');
    const stored = await storage.get(LAST_LAUNCH_KEY);
    const now = Number(nowFn());
    const waitMs = pacingDelay(stored?.[LAST_LAUNCH_KEY], now, minGapMs);
    if (waitMs > 0) await sleepFn(waitMs);
    const launchAt = Number(nowFn());
    await storage.set({ [LAST_LAUNCH_KEY]: launchAt });
    return { waitMs, launchAt };
  }

  function classifyTab(tab = {}) {
    const url = String(tab.url || '').trim();
    const title = String(tab.title || '').trim();
    if (CRASH_URL_PREFIXES.some(prefix => url.toLowerCase().startsWith(prefix))) {
      return { healthy: false, crashed: true, reason: 'browser-error-url', url, title };
    }
    if (CRASH_PATTERNS.some(pattern => pattern.test(title))) {
      return { healthy: false, crashed: true, reason: 'browser-crash-title', url, title };
    }
    if (url && !url.toLowerCase().startsWith(HOME_ORIGIN.toLowerCase() + '/') && url !== 'about:blank') {
      return { healthy: false, crashed: false, reason: 'unexpected-launch-url', url, title };
    }
    return { healthy: true, crashed: false, reason: 'tab-metadata-healthy', url, title };
  }

  function inspectPage(root = globalThis.document) {
    if (!root) return { healthy: false, rateLimited: false, crashed: false, reason: 'document-unavailable' };
    const text = String(root.body?.innerText || root.documentElement?.innerText || '');
    const rateLimited = RATE_LIMIT_PATTERNS.some(pattern => pattern.test(text));
    if (rateLimited) {
      return { healthy: false, rateLimited: true, crashed: false, reason: 'chatgpt-rate-limited' };
    }
    const crashed = CRASH_PATTERNS.some(pattern => pattern.test(text));
    if (crashed) {
      return { healthy: false, rateLimited: false, crashed: true, reason: 'browser-crash-content' };
    }
    return { healthy: true, rateLimited: false, crashed: false, reason: 'page-content-healthy' };
  }

  function crashRecoveryKey(tabId) {
    return CRASH_RECOVERY_PREFIX + String(Number(tabId));
  }

  function nextCrashRecoveryAction(state = {}, now = Date.now()) {
    const updatedAt = Number(state.updatedAt || 0);
    const fresh = updatedAt > 0 && Math.max(0, Number(now) - updatedAt) <= CRASH_RECOVERY_WINDOW_MS;
    const attempts = fresh ? Math.max(0, Number(state.attempts || 0)) : 0;
    if (attempts <= 0) return { action: 'reload-and-continue', attempts };
    if (attempts === 1) return { action: 'replace-and-continue', attempts };
    return { action: 'halt', attempts };
  }

  function buildCrashContinuationPrompt(context = {}) {
    const branch = String(context.branch || '').trim();
    const head = String(context.head || '').trim();
    const lines = [
      'Continue.',
      'The browser tab crashed and has now been recovered.',
      'First reconcile the real project state and Git/source-of-truth. Do not repeat work or side effects that already completed.',
      'Continue from the latest valid checkpoint, finish the unfinished work, and provide the complete final answer rather than only a progress update.'
    ];
    if (branch) lines.push('branch: ' + branch);
    if (head) lines.push('last known HEAD: ' + head);
    return lines.join('\n');
  }

  function replacementAllowed(count, max = MAX_REPLACEMENTS) {
    return Math.max(0, Number(count || 0)) < Math.max(1, Number(max || MAX_REPLACEMENTS));
  }

  function rateLimitRecheckAllowed(count, max = MAX_RATE_LIMIT_RECHECKS) {
    return Math.max(0, Number(count || 0)) < Math.max(1, Number(max || MAX_RATE_LIMIT_RECHECKS));
  }

  function retryDelay(reason, attempt = 1) {
    const n = Math.max(1, Number(attempt || 1));
    if (reason === 'chatgpt-rate-limited') return 60000;
    return Math.min(60000, 5000 * (2 ** Math.min(3, n - 1)));
  }

  function promptOwnershipKey(payload = {}) {
    const projectId = String(payload.projectId || 'project').trim() || 'project';
    const scope = String(payload.laneId || payload.conversationId || 'prompt').trim() || 'prompt';
    const promptHash = simpleHash(String(payload.prompt || ''));
    return `chatsentinel:prompt-owner:${projectId}:${scope}:${promptHash}`;
  }

  async function claimPromptOwnership(storage, payload, tabId, getTab, options = {}) {
    if (!storage?.get || !storage?.set) throw new TypeError('prompt-owner-storage-required');
    const key = promptOwnershipKey(payload);
    const stored = await storage.get(key);
    const owner = stored?.[key] || null;
    const numericTabId = Number(tabId);
    if (owner?.tabId === numericTabId) return { allowed: true, key, owner, sameOwner: true };

    let ownerLive = false;
    if (Number.isInteger(Number(owner?.tabId)) && typeof getTab === 'function') {
      ownerLive = Boolean(await getTab(Number(owner.tabId)));
    }
    const replaceFrom = Number(options.replaceFromTabId);
    const explicitTakeover = ownerLive && Number.isInteger(replaceFrom) && Number(owner.tabId) === replaceFrom;
    if (ownerLive && !explicitTakeover) {
      return { allowed: false, key, owner, reason: 'prompt-owned-by-live-tab' };
    }
    const nextOwner = {
      tabId: numericTabId,
      commandId: String(options.commandId || ''),
      projectId: String(payload.projectId || ''),
      laneId: String(payload.laneId || ''),
      conversationId: String(payload.conversationId || ''),
      promptHash: simpleHash(String(payload.prompt || '')),
      claimedAt: new Date().toISOString()
    };
    await storage.set({ [key]: nextOwner });
    return { allowed: true, key, owner: nextOwner, previousOwner: owner, explicitTakeover };
  }

  async function markPromptDelivered(storage, ticket, tabId) {
    if (!ticket?.key || !storage?.get || !storage?.set) return false;
    const stored = await storage.get(ticket.key);
    const owner = stored?.[ticket.key];
    if (!owner || Number(owner.tabId) !== Number(tabId)) return false;
    await storage.set({ [ticket.key]: { ...owner, deliveredAt: new Date().toISOString() } });
    return true;
  }

  async function releasePromptOwnership(storage, ticket, tabId, getTab) {
    if (!ticket?.key || !storage?.get || !storage?.set || !storage?.remove) return false;
    const stored = await storage.get(ticket.key);
    const owner = stored?.[ticket.key];
    if (!owner || Number(owner.tabId) !== Number(tabId)) return false;
    const previous = ticket.previousOwner;
    const previousLive = previous?.tabId && typeof getTab === 'function'
      ? Boolean(await getTab(Number(previous.tabId)))
      : false;
    if (previousLive) await storage.set({ [ticket.key]: previous });
    else await storage.remove(ticket.key);
    return true;
  }

  function replacementProgress(progress = {}, reason) {
    return {
      step: 'launch-replace',
      tabId: null,
      attached: false,
      grouped: false,
      promptSent: false,
      stableConversationId: null,
      launchFailureReason: reason,
      replacementCount: Math.max(0, Number(progress.replacementCount || 0)) + 1
    };
  }

  function rateLimitProgress(progress = {}) {
    return {
      step: 'launch-rate-limited',
      promptSent: false,
      launchFailureReason: 'chatgpt-rate-limited',
      rateLimitRecheckCount: Math.max(0, Number(progress.rateLimitRecheckCount || 0)) + 1
    };
  }

  function simpleHash(value) {
    let hash = 2166136261;
    for (const character of String(value || '')) {
      hash ^= character.charCodeAt(0);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(36);
  }

  function defaultSleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  globalThis.ChatSentinelTabLaunchGuard = Object.freeze({
    CHATGPT_HOME,
    LAST_LAUNCH_KEY,
    DEFAULT_MIN_LAUNCH_GAP_MS,
    DEFAULT_PAGE_SETTLE_MS,
    MAX_REPLACEMENTS,
    MAX_RATE_LIMIT_RECHECKS,
    CRASH_RECOVERY_PREFIX,
    CRASH_RECOVERY_WINDOW_MS,
    safeNewChatUrl,
    safeExistingChatUrl,
    containsPromptInUrl,
    pacingDelay,
    acquireLaunchSlot,
    classifyTab,
    inspectPage,
    crashRecoveryKey,
    nextCrashRecoveryAction,
    buildCrashContinuationPrompt,
    replacementAllowed,
    rateLimitRecheckAllowed,
    retryDelay,
    promptOwnershipKey,
    claimPromptOwnership,
    markPromptDelivered,
    releasePromptOwnership,
    replacementProgress,
    rateLimitProgress
  });
})();
