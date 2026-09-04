(() => {
  const ACTIONS = new Set(['FOCUS_CHAT', 'RELOAD_CHAT', 'CLOSE_CHAT', 'REPLACE_CHAT']);
  const DEFAULT_POLICY = Object.freeze({
    attempts: 3,
    retryDelayMs: 250,
    staleFocusFallback: true,
    staleReloadOutcome: 'replace',
    closeOldAfterReplace: true
  });

  async function execute(command, adapter, policy = {}) {
    if (!ACTIONS.has(command?.type)) throw new Error(`unsupported-chat-control:${command?.type}`);
    const effective = { ...DEFAULT_POLICY, ...(policy || {}) };
    const marker = terminalMarker(command.type);
    if (command.progress?.[marker]) return { ...(command.progress.result || {}), idempotentReplay: true };

    const operation = () => dispatch(command, adapter, effective);
    const result = await withRetries(operation, effective, command.type);
    if (adapter?.progress) {
      await adapter.progress({ [marker]: true, result, chatControlStep: marker });
    }
    return result;
  }

  async function dispatch(command, adapter, policy) {
    const payload = command.payload || {};
    if (command.type === 'FOCUS_CHAT') return focus(payload, adapter, policy);
    if (command.type === 'RELOAD_CHAT') return reload(payload, adapter, policy);
    if (command.type === 'CLOSE_CHAT') return close(payload, adapter);
    return replace(command, adapter, policy);
  }

  async function focus(payload, adapter, policy) {
    const tab = await adapter.resolveTarget(payload);
    if (tab) {
      const focused = await adapter.focusTab(tab.id, tab.url);
      if (!focused?.ok) throw new Error(focused?.error || 'focus-failed');
      return { ...focused, staleRecovered: false };
    }
    if (policy.staleFocusFallback && payload.url) {
      const focused = await adapter.focusTab(undefined, payload.url);
      if (!focused?.ok) throw new Error(focused?.error || 'stale-focus-fallback-failed');
      return { ...focused, staleRecovered: true };
    }
    throw new Error('target-tab-stale');
  }

  async function reload(payload, adapter, policy) {
    const tab = await adapter.resolveTarget(payload);
    if (tab) {
      await adapter.reloadTab(tab.id);
      return { tabId: tab.id, reloaded: true, staleRecovered: false };
    }
    if (policy.staleReloadOutcome !== 'replace') throw new Error('target-tab-stale');
    if (!adapter.replaceStale) throw new Error('stale-replacement-unavailable');
    const replacement = await adapter.replaceStale(payload);
    return { ...replacement, reloaded: false, staleRecovered: true, staleAction: 'replace' };
  }

  async function close(payload, adapter) {
    const tab = await adapter.resolveTarget(payload);
    if (!tab) return { closed: false, reason: 'already-closed', staleRecovered: true };
    await adapter.closeTab(tab.id);
    return { tabId: tab.id, closed: true, staleRecovered: false };
  }

  async function replace(command, adapter, policy) {
    const payload = command.payload || {};
    const oldTab = await adapter.resolveTarget(payload);
    const replacement = await adapter.createReplacement(command);
    if (!replacement?.tabId) throw new Error('replacement-create-failed');

    let oldClosed = false;
    const shouldClose = payload.closeOld ?? policy.closeOldAfterReplace;
    if (shouldClose && oldTab?.id && oldTab.id !== replacement.tabId) {
      await adapter.closeTab(oldTab.id).catch(error => {
        if (!isMissingTabError(error)) throw error;
      });
      oldClosed = true;
    }
    return {
      ...replacement,
      replacedTabId: oldTab?.id,
      oldClosed,
      staleRecovered: !oldTab
    };
  }

  async function withRetries(operation, policy, action) {
    let lastError;
    const attempts = Math.max(1, Number(policy.attempts) || DEFAULT_POLICY.attempts);
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      try { return await operation(); }
      catch (error) {
        lastError = error;
        if (attempt >= attempts || !isRetryable(error)) break;
        await sleep(Math.max(0, Number(policy.retryDelayMs) || 0) * attempt);
      }
    }
    throw new Error(`${action.toLowerCase()}-failed:${String(lastError?.message || lastError)}`);
  }

  function terminalMarker(type) {
    return ({
      FOCUS_CHAT: 'focusCompleted',
      RELOAD_CHAT: 'reloadCompleted',
      CLOSE_CHAT: 'closeCompleted',
      REPLACE_CHAT: 'replaceCompleted'
    })[type];
  }

  function isRetryable(error) {
    const value = String(error?.message || error || '');
    return !/unsupported-chat-control|replacement-create-failed/.test(value);
  }

  function isMissingTabError(error) {
    return /No tab with id|Invalid tab ID|not found/i.test(String(error?.message || error || ''));
  }

  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  globalThis.ChatSentinelChatControl = {
    execute,
    DEFAULT_POLICY,
    terminalMarker
  };
})();
