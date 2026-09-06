(() => {
  let lastMutationAt = Date.now();
  let lastSignal = '';
  const runtimeContext = globalThis.ChatSentinelRuntimeContext;
  let disposed = false;
  let observer = null;
  let heartbeatTimer = null;
  let lastAssistantFingerprint = '';
  let lastAssistantChangedAt = Date.now();

  const runtimeListener = (message, _sender, sendResponse) => {
    if (message?.type === 'CHATSENTINEL_GET_IDENTITY') {
      sendResponse({ ok: true, identity: currentIdentity() });
      return;
    }
    if (message?.type === 'CHATSENTINEL_GET_LAUNCH_STATE') {
      const guard = globalThis.ChatSentinelTabLaunchGuard;
      const experience = globalThis.ChatSentinelChatExperienceGuard?.ensureChat?.(document) || { detected: false, changed: false };
      const requestRate = globalThis.ChatSentinelRequestRateLimit;
      const rateObservation = requestRate?.inspect?.(document) || { active: false, incidentKey: '' };
      const state = guard?.inspectPage?.(document) || { healthy: false, rateLimited: false, crashed: false, reason: 'launch-guard-unavailable' };
      const rateDismissal = rateObservation.active ? requestRate?.dismiss?.(document) : null;
      sendResponse({
        ok: true,
        ...state,
        healthy: rateObservation.active ? false : state.healthy,
        rateLimited: rateObservation.active || state.rateLimited,
        reason: rateObservation.active ? 'chatgpt-rate-limited' : state.reason,
        requestRateLimitIncidentKey: rateObservation.incidentKey || '',
        requestRateLimitDismissed: Boolean(rateDismissal?.dismissed),
        experienceDetected: Boolean(experience.detected),
        workModeCorrected: Boolean(experience.changed),
        workSelected: Boolean(experience.workSelected && !experience.chatSelected && !experience.changed)
      });
      return;
    }
    if (message?.type === 'CHATSENTINEL_PROMPT_DELIVERY_STATE') {
      const delivery = globalThis.ChatSentinelPromptDelivery;
      sendResponse(delivery?.inspect?.(document, String(message.prompt || ''), location.href) || {
        ok: false, confirmed: false, reason: 'prompt-delivery-component-unavailable'
      });
      return;
    }
    if (message?.type === 'CHATSENTINEL_PROMPT_DELIVERY_CONFIRMED') {
      const commandId = String(message.commandId || '').trim();
      if (commandId) sessionStorage.setItem(`chatsentinel:command:${commandId}`, 'confirmed');
      sendResponse({ ok: true, confirmed: Boolean(commandId) });
      return;
    }
    if (message?.type === 'CHATSENTINEL_SEND_PROMPT') {
      const commandId = String(message.commandId || '').trim();
      const marker = commandId ? `chatsentinel:command:${commandId}` : '';
      if (marker && sessionStorage.getItem(marker) === 'confirmed') {
        sendResponse({ ok: true, action: 'send-prompt', executed: false, deduplicated: true, deliveryConfirmed: true });
        return;
      }
      Promise.resolve(window.ChatSentinelActuator?.sendPendingPrompt?.(String(message.prompt || '')))
        .then(result => sendResponse(result || { ok: false, reason: 'actuator-missing' }))
        .catch(error => sendResponse({ ok: false, error: String(error) }));
      return true;
    }
    if (message?.type !== 'CHATSENTINEL_EXECUTE') return;
    Promise.resolve(window.ChatSentinelActuator?.executeDecision(message.decision, message.context))
      .then(result => sendResponse(result || { ok: false, reason: 'actuator-missing' }))
      .catch(error => sendResponse({ ok: false, error: String(error) }));
    return true;
  };
  if (!runtimeContext?.addMessageListener?.(runtimeListener)) return;

  deliverPendingPrompt();

  observer = new MutationObserver(() => {
    lastMutationAt = Date.now();
    emit();
  });

  observer.observe(document.documentElement, {
    subtree: true,
    childList: true,
    characterData: true
  });

  heartbeatTimer = setInterval(emit, 5000);
  emit();

  function emit() {
    if (disposed) return;
    if (!runtimeContext?.isAlive?.()) { dispose(); return; }
    const text = document.body?.innerText || '';
    const experience = globalThis.ChatSentinelChatExperienceGuard?.ensureChat?.(document) || { detected: false, changed: false };
    const launchInspection = globalThis.ChatSentinelTabLaunchGuard?.inspectPage?.(document) || { healthy: true, crashed: false, reason: 'not-inspected' };
    const assistant = lastAssistantTurn();
    if (assistant.fingerprint && assistant.fingerprint !== lastAssistantFingerprint) {
      lastAssistantFingerprint = assistant.fingerprint;
      lastAssistantChangedAt = Date.now();
    }
    const buttons = [...document.querySelectorAll('button')]
      .map(button => (button.innerText || button.getAttribute('aria-label') || '').trim())
      .filter(Boolean);

    const continueVisible = buttons.some(value => /continue generating|continue/i.test(value));
    const stopVisible = buttons.some(value => /stop generating|stop/i.test(value));
    const interruption = globalThis.ChatSentinelResponseCompletion?.inspect?.(document);
    const connectionInterrupted = interruption?.active === true;
    const requestRateApi = globalThis.ChatSentinelRequestRateLimit;
    const requestRateObservation = requestRateApi?.inspect?.(document) || { active: false };
    const requestRateDismissal = requestRateObservation.active
      ? requestRateApi?.dismiss?.(document)
      : null;
    const delivery = globalThis.ChatSentinelMessageDeliveryRecovery?.inspect?.(document);
    const retryVisible = !delivery?.timeoutMarkerPresent && buttons.some(value => /retry|try again/i.test(value));
    const messageDeliveryTimedOut = delivery?.active === true;
    const messageDeliveryRetryCount = delivery?.incidentKey
      ? globalThis.ChatSentinelMessageDeliveryRecovery?.retryCount?.(delivery.incidentKey) || 0
      : 0;
    const conversationDead = /conversation not found|unable to load conversation|conversation is unavailable/i.test(text);
    const genericUiFailure = /there was an error generating a response|something went wrong|network error|failed to load|an error occurred|response failed/i.test(text);
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
      genericUiFailure,
      pageCrashed: launchInspection.crashed === true,
      pageFailureReason: launchInspection.reason || '',
      experienceWorkDetected: Boolean(experience.detected),
      workModeCorrected: Boolean(experience.changed),
      workSelected: Boolean(experience.workSelected && !experience.chatSelected && !experience.changed),
      lastAssistantText: assistant.text,
      lastAssistantFingerprint: assistant.fingerprint,
      assistantSettledMs: assistant.fingerprint ? Math.max(0, Date.now() - lastAssistantChangedAt) : 0,
      requestRateLimited: requestRateObservation.active === true,
      requestRateLimitIncidentKey: requestRateObservation.incidentKey || '',
      requestRateLimitDismissed: Boolean(requestRateDismissal?.dismissed),
      requestRateLimitDismissLabel: requestRateDismissal?.dismissLabel || requestRateObservation.dismissLabel || '',
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
    runtimeContext.sendMessage(signal).then(result => {
      if (result?.invalidated) dispose();
    }).catch(() => dispose());
  }

  function lastAssistantTurn() {
    const turns = [...document.querySelectorAll('[data-message-author-role="assistant"]')];
    const node = turns.at(-1);
    const text = String(node?.innerText || node?.textContent || '').replace(/\s+/g, ' ').trim().slice(-2000);
    return { text, fingerprint: text ? simpleHash(text) : '' };
  }

  function simpleHash(value) {
    let hash = 2166136261;
    for (const character of String(value || '')) {
      hash ^= character.charCodeAt(0);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(36);
  }
  function dispose() {
    if (disposed) return;
    disposed = true;
    observer?.disconnect?.();
    observer = null;
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    heartbeatTimer = null;
    runtimeContext?.removeMessageListener?.(runtimeListener);
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
    const trySend = async () => {
      attempts += 1;
      const result = await Promise.resolve(window.ChatSentinelActuator?.sendPendingPrompt?.(pending));
      if (result?.ok) return;
      if (attempts < 60) return setTimeout(trySend, 500);
      sessionStorage.setItem('chatsentinel:pendingPrompt', pending);
      console.warn('ChatSentinel: pending recovery prompt could not be delivered');
    };
    setTimeout(trySend, 500);
  }
})();
