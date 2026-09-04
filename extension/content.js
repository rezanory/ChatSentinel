(() => {
  const ERROR_TEXTS = [
    'Connection interrupted. Waiting for the complete answer',
    'Something went wrong',
    'There was an error generating a response'
  ];

  let lastMutationAt = Date.now();
  let lastSignal = '';

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type !== 'CHATSENTINEL_EXECUTE') return;
    Promise.resolve(window.ChatSentinelActuator?.executeDecision(message.decision, message.context))
      .then(result => sendResponse(result || { ok: false, reason: 'actuator-missing' }))
      .catch(error => sendResponse({ ok: false, error: String(error) }));
    return true;
  });

  const pending = window.ChatSentinelActuator?.consumePendingPrompt?.();
  if (pending) {
    setTimeout(() => {
      window.ChatSentinelActuator?.sendPendingPrompt?.(pending);
    }, 1500);
  }

  const observer = new MutationObserver(() => {
    lastMutationAt = Date.now();
    emit();
  });
  observer.observe(document.documentElement, {
    subtree: true,
    childList: true,
    characterData: true,
    attributes: true
  });

  setInterval(emit, 5000);
  emit();

  function emit() {
    const text = document.body?.innerText || '';
    const buttons = [...document.querySelectorAll('button')]
      .map(button => (button.innerText || button.getAttribute('aria-label') || '').trim())
      .filter(Boolean);

    const retryVisible = buttons.some(value => /retry|try again/i.test(value));
    const continueVisible = buttons.some(value => /continue generating|continue/i.test(value));
    const stopVisible = buttons.some(value => /stop generating|stop/i.test(value));
    const connectionInterrupted = ERROR_TEXTS.some(error => text.includes(error));
    const conversationDead = /conversation not found|unable to load conversation/i.test(text);
    const progressAgeMs = Date.now() - lastMutationAt;
    const uiFrozen = progressAgeMs >= 180000 && !stopVisible;

    const signal = {
      type: 'CHATSENTINEL_SIGNAL',
      url: location.href,
      conversationId: conversationId(),
      retryVisible,
      continueVisible,
      connectionInterrupted,
      conversationDead,
      uiFrozen,
      progressAgeMs,
      state: stopVisible ? 'RUNNING' : 'IDLE',
      observedAt: new Date().toISOString()
    };

    const fingerprint = JSON.stringify(signal, (key, value) =>
      key === 'progressAgeMs' || key === 'observedAt' ? undefined : value
    );
    if (fingerprint === lastSignal && progressAgeMs < 60000) return;
    lastSignal = fingerprint;
    chrome.runtime.sendMessage(signal).catch(() => {});
  }

  function conversationId() {
    const match = location.pathname.match(/\/c\/([^/?#]+)/);
    return match?.[1] || `page:${location.pathname}`;
  }
})();
