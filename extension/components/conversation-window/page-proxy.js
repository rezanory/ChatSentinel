(() => {
  const PATCH_FLAG = '__CHATSENTINEL_CONVERSATION_WINDOW_PATCHED__';
  const CONFIG_KEY = 'chatsentinel:conversation-window';
  if (globalThis[PATCH_FLAG]) return;
  globalThis[PATCH_FLAG] = true;

  const nativeFetch = window.fetch.bind(window);
  let config = readConfig();
  let configReadyResolve;
  let configReady = new Promise(resolve => { configReadyResolve = resolve; });

  window.addEventListener('chatsentinel-conversation-window-config', event => {
    try {
      const next = typeof event.detail === 'string' ? JSON.parse(event.detail) : event.detail;
      config = normalizeConfig(next);
      localStorage.setItem(CONFIG_KEY, JSON.stringify(config));
      configReadyResolve?.();
      configReadyResolve = null;
    } catch {}
  });

  window.fetch = async (...args) => interceptedFetch(...args);
  window.dispatchEvent(new CustomEvent('chatsentinel-conversation-window-ready'));

  async function interceptedFetch(...args) {
    const meta = requestMeta(args[0], args[1]);
    if (!meta || !isConversationRequest(meta.method, meta.url)) return nativeFetch(...args);

    await waitForConfig(100);
    const activeConfig = config || readConfig();
    if (!activeConfig.enabled) return nativeFetch(...args);

    const response = await nativeFetch(...args);
    try {
      if (!isJson(response)) return response;
      const json = await response.clone().json();
      const trimmed = globalThis.ChatSentinelConversationTrimmer?.trimConversation?.(
        json,
        activeConfig.keepTurns
      );
      if (!trimmed || trimmed.stats.removedTurns <= 0) {
        dispatchStatus({ ...trimmed?.stats, enabled: true, trimmed: false });
        return response;
      }
      dispatchStatus({ ...trimmed.stats, enabled: true, trimmed: true });
      return modifiedResponse(response, trimmed.data);
    } catch (error) {
      dispatchStatus({ enabled: true, trimmed: false, error: String(error) });
      return response;
    }
  }

  function requestMeta(input, init) {
    try {
      const method = (init?.method || (input instanceof Request ? input.method : 'GET')).toUpperCase();
      const value = input instanceof Request ? input.url : input instanceof URL ? input.href : String(input);
      return { method, url: new URL(value, location.href) };
    } catch { return null; }
  }

  function isConversationRequest(method, url) {
    return method === 'GET' && /^\/backend-api\/(conversation|shared_conversation)\/[^/]+\/?$/.test(url.pathname);
  }

  function isJson(response) {
    return (response.headers.get('content-type') || '').toLowerCase().includes('application/json');
  }

  function modifiedResponse(original, data) {
    const headers = new Headers(original.headers);
    headers.delete('content-length');
    headers.delete('content-encoding');
    headers.set('content-type', 'application/json; charset=utf-8');
    const next = new Response(JSON.stringify(data), {
      status: original.status,
      statusText: original.statusText,
      headers
    });
    try {
      if (original.url) Object.defineProperty(next, 'url', { value: original.url });
      if (original.type) Object.defineProperty(next, 'type', { value: original.type });
    } catch {}
    return next;
  }

  function normalizeConfig(value) {
    return {
      enabled: value?.enabled !== false,
      keepTurns: Math.max(4, Math.min(200, Number(value?.keepTurns) || 40))
    };
  }

  function readConfig() {
    try {
      const stored = localStorage.getItem(CONFIG_KEY);
      if (stored) return normalizeConfig(JSON.parse(stored));
    } catch {}
    return normalizeConfig({ enabled: true, keepTurns: 40 });
  }

  async function waitForConfig(timeoutMs) {
    if (!configReadyResolve) return;
    await Promise.race([
      configReady,
      new Promise(resolve => setTimeout(resolve, timeoutMs))
    ]);
    if (configReadyResolve) {
      configReadyResolve();
      configReadyResolve = null;
    }
  }

  function dispatchStatus(status) {
    window.dispatchEvent(new CustomEvent('chatsentinel-conversation-window-status', {
      detail: JSON.stringify(status || {})
    }));
  }
})();
