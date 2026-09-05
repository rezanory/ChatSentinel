(() => {
  const INVALIDATED_REASON = 'extension-context-invalidated';

  function runtime() {
    try {
      const value = globalThis.chrome?.runtime;
      if (!value?.id || typeof value.sendMessage !== 'function') return null;
      return value;
    } catch {
      return null;
    }
  }

  function isAlive() {
    return Boolean(runtime());
  }

  function isInvalidationError(error) {
    const text = String(error?.message || error || '');
    return /extension context invalidated/i.test(text) ||
      /cannot read properties of undefined.*sendmessage/i.test(text);
  }

  function invalidatedResult(error) {
    return {
      ok: false,
      invalidated: true,
      reason: INVALIDATED_REASON,
      error: error ? String(error?.message || error) : undefined
    };
  }

  function sendMessage(message) {
    try {
      const value = runtime();
      if (!value) return Promise.resolve(invalidatedResult());
      return Promise.resolve(value.sendMessage(message))
        .catch(error => isInvalidationError(error)
          ? invalidatedResult(error)
          : ({ ok: false, invalidated: false, error: String(error?.message || error) }));
    } catch (error) {
      return Promise.resolve(isInvalidationError(error)
        ? invalidatedResult(error)
        : ({ ok: false, invalidated: false, error: String(error?.message || error) }));
    }
  }

  function addMessageListener(listener) {
    try {
      const value = runtime();
      if (!value?.onMessage?.addListener) return false;
      value.onMessage.addListener(listener);
      return true;
    } catch {
      return false;
    }
  }

  function removeMessageListener(listener) {
    try {
      const value = globalThis.chrome?.runtime;
      value?.onMessage?.removeListener?.(listener);
      return true;
    } catch {
      return false;
    }
  }

  globalThis.ChatSentinelRuntimeContext = Object.freeze({
    INVALIDATED_REASON,
    runtime,
    isAlive,
    isInvalidationError,
    sendMessage,
    addMessageListener,
    removeMessageListener
  });
})();
