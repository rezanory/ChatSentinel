(() => {
  let lastMutationAt = Date.now();
  let lastSignal = '';

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === 'CHATSENTINEL_GET_IDENTITY') {
      sendResponse({ ok: true, identity: currentIdentity() });
      return;
    }
    if (message?.type === 'CHATSENTINEL_SEND_PROMPT') {
      const commandId = String(message.commandId || '').trim();
      const marker = commandId ? `chatsentinel:command:${commandId}` : '';
      if (marker && sessionStorage.getItem(marker) === 'sent') {
        sendResponse({ ok: true, action: 'send-prompt', executed: false, deduplicated: true });
        return;
      }
      Promise.resolve(window.ChatSentinelActuator?.sendPendingPrompt?.(String(message.prompt || '')))
        .then(result => {
          if (result?.ok && marker) sessionStorage.setItem(marker, 'sent');
          sendResponse(result || { ok: false, reason: 'actuator-missing' });
        })
        .catch(error => sendResponse({ ok: false, error: String(error) }));
      return true;
    }
    if (message?.type !== 'CHATSENTINEL_EXECUTE') return;
    Promise.resolve(window.ChatSentinelActuator?.executeDecision(message.decision, message.context))
      .then(result => sendResponse(result || { ok: false, reason: 'actuator-missing' }))
      .catch(error => sendResponse({ ok: false, error: String(error) }));
    return true;
  });

  deliverPendingPrompt();

  const observer = new MutationObserver(() => {
    lastMutationAt = Date.now();
    emit();
  });

  observer.observe(document.documentElement, {
    subtree: true,
    childList: true,
    characterData: true
  });

  setInterval(emit, 5000);
  emit();

  function emit() {
    const text = document.body?.innerText || '';
    const buttons = [...document.querySelectorAll('button')]
      .map(button => (button.innerText || button.getAttribute('aria-label') || '').trim())
      .filter(Boolean);

    const continueVisible = buttons.some(value => /continue generating|continue/i.test(value));
    const stopVisible = buttons.some(value => /stop generating|stop/i.test(value));
    const interruption = globalThis.ChatSentinelResponseCompletion?.inspect?.(document);
    const connectionInterrupted = interruption?.active === true;
    const delivery = globalThis.ChatSentinelMessageDeliveryRecovery?.inspect?.(document);
    const retryVisible = !delivery?.timeoutMarkerPresent && buttons.some(value => /retry|try again/i.test(value));
    const messageDeliveryTimedOut = delivery?.active === true;
    const messageDeliveryRetryCount = delivery?.incidentKey
      ? globalThis.ChatSentinelMessageDeliveryRecovery?.retryCount?.(delivery.incidentKey) || 0
      : 0;
    const conversationDead = /conversation not found|unable to load conversation/i.test(text);
    const progressAgeMs = testProgressAge() ?? (Date.now() - lastMutationAt);
    const uiFrozen = progressAgeMs >= 180000 && !stopVisible;
    const identity = currentIdentity();

    const signal = {
      type: 'CHATSENTINEL_SIGNAL',
      url: location.href,
      conversationId: identity?.id,
      identitySource: identity?.source,
      retryVisible,
      continueVisible,
      messageDeliveryTimedOut,
      messageDeliveryIncidentKey: delivery?.incidentKey,
      messageDeliveryRetryCount,
      connectionInterrupted,
      interruptionSource: interruption?.source,
      interruptionIncidentKey: interruption?.incidentKey,
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

  function currentIdentity() {
    return window.ChatSentinelIdentity?.resolve?.() || null;
  }

  function testProgressAge() {
    if (!isFixture()) return null;
    const raw = Number(document.documentElement.dataset.chatsentinelTestProgressAge);
    return Number.isFinite(raw) && raw >= 0 ? raw : null;
  }

  function isFixture() {
    return location.hostname === '127.0.0.1' && location.port === '4320';
  }

  function deliverPendingPrompt() {
    const pending = window.ChatSentinelActuator?.consumePendingPrompt?.();
    if (!pending) return;
    let attempts = 0;
    const trySend = () => {
      attempts += 1;
      const result = window.ChatSentinelActuator?.sendPendingPrompt?.(pending);
      if (result?.ok) return;
      if (attempts < 60) return setTimeout(trySend, 500);
      sessionStorage.setItem('chatsentinel:pendingPrompt', pending);
      console.warn('ChatSentinel: pending recovery prompt could not be delivered');
    };
    setTimeout(trySend, 500);
  }
})();
