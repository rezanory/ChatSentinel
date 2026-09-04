(() => {
  const STORAGE_KEY = 'conversationWindowConfig';
  const DEFAULTS = Object.freeze({ enabled: true, keepTurns: 40 });
  let current = { ...DEFAULTS };
  let lastStatus = null;

  initialize().catch(error => console.warn('ChatSentinel conversation window init failed', error));

  async function initialize() {
    const stored = await chrome.storage.local.get(STORAGE_KEY);
    current = normalize(stored[STORAGE_KEY] || DEFAULTS);
    await chrome.storage.local.set({ [STORAGE_KEY]: current });
    dispatchConfig();

    window.addEventListener('chatsentinel-conversation-window-ready', dispatchConfig);
    window.addEventListener('chatsentinel-conversation-window-status', handleStatus);
    window.addEventListener('popstate', () => queueMicrotask(dispatchConfig));

    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local' || !changes[STORAGE_KEY]?.newValue) return;
      current = normalize(changes[STORAGE_KEY].newValue);
      dispatchConfig();
    });
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === 'CHATSENTINEL_CONVERSATION_WINDOW_GET') {
      sendResponse({ ok: true, config: current, status: lastStatus });
      return;
    }
    if (message?.type !== 'CHATSENTINEL_CONVERSATION_WINDOW_SET') return;
    const next = normalize({ ...current, ...(message.config || {}) });
    chrome.storage.local.set({ [STORAGE_KEY]: next })
      .then(() => sendResponse({ ok: true, config: next }))
      .catch(error => sendResponse({ ok: false, error: String(error) }));
    return true;
  });

  function dispatchConfig() {
    window.dispatchEvent(new CustomEvent('chatsentinel-conversation-window-config', {
      detail: JSON.stringify(current)
    }));
  }

  function handleStatus(event) {
    try {
      lastStatus = typeof event.detail === 'string' ? JSON.parse(event.detail) : event.detail;
      document.documentElement.dataset.chatsentinelWindowEnabled = current.enabled ? '1' : '0';
      document.documentElement.dataset.chatsentinelWindowKeepTurns = String(current.keepTurns);
      document.documentElement.dataset.chatsentinelWindowRemovedTurns = String(lastStatus?.removedTurns || 0);
      document.documentElement.dataset.chatsentinelWindowVisibleKept = String(lastStatus?.visibleKept || 0);
    } catch {}
  }

  function normalize(value) {
    return {
      enabled: value?.enabled !== false,
      keepTurns: Math.max(4, Math.min(200, Number(value?.keepTurns) || DEFAULTS.keepTurns))
    };
  }
})();
