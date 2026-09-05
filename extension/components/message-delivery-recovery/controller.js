(() => {
  const DELIVERY_TIMEOUT_TEXTS = Object.freeze([
    'Message delivery timed out. Please try again.',
    'Message delivery timed out'
  ]);
  const ATTEMPT_PREFIX = 'chatsentinel:message-delivery:';
  const DEFAULT_COOLDOWN_MS = 5000;
  const MAX_ATTEMPTS = 2;

  function containsDeliveryTimeout(text) {
    const value = String(text || '');
    return DELIVERY_TIMEOUT_TEXTS.some(marker => value.includes(marker));
  }

  function inspect(root = globalThis.document) {
    if (!root) return inactive('no-document');
    const marker = findMarker(root);
    if (!marker) return inactive('marker-missing');

    const turnNodes = [...(root.querySelectorAll?.('[data-message-author-role]') || [])];
    const superseded = turnNodes.some(node => isConversationTurn(node) && follows(marker.node, node));
    if (superseded) return inactive('historical-marker', { markerText: marker.text, timeoutMarkerPresent: true });

    const retryButton = findAssociatedRetryButton(root, marker.node);
    if (!retryButton) return inactive('retry-button-missing', { markerText: marker.text, timeoutMarkerPresent: true });
    const incidentKey = incidentKeyFor(marker.node, marker.text, turnNodes);
    return {
      active: true,
      timeoutMarkerPresent: true,
      source: 'delivery-timeout-marker',
      markerText: marker.text,
      incidentKey,
      retryVisible: true,
      retryButton
    };
  }

  function prepareAttempt(root = globalThis.document, storage = safeSessionStorage(), now = Date.now(), options = {}) {
    const observation = inspect(root);
    if (!observation.active) return { allowed: false, reason: observation.reason, observation };
    const cooldownMs = Math.max(1000, Number(options.cooldownMs || DEFAULT_COOLDOWN_MS));
    const maxAttempts = Math.max(1, Number(options.maxAttempts || MAX_ATTEMPTS));
    const key = attemptKey(observation.incidentKey);
    const state = readAttemptState(storage, key);
    if (state.count >= maxAttempts) {
      return { allowed: false, reason: 'retry-budget-exhausted', key, state, observation };
    }
    if (state.lastAt > 0 && now - state.lastAt < cooldownMs) {
      return { allowed: false, deduplicated: true, reason: 'attempt-cooldown', key, state, observation };
    }
    return { allowed: true, key, state, observation, maxAttempts, cooldownMs };
  }

  function markAttempt(ticket, storage = safeSessionStorage(), now = Date.now()) {
    if (!ticket?.key || !storage?.setItem) return false;
    const current = readAttemptState(storage, ticket.key);
    storage.setItem(ticket.key, JSON.stringify({
      count: current.count + 1,
      lastAt: now
    }));
    return true;
  }

  function retryCount(incidentKey, storage = safeSessionStorage()) {
    if (!incidentKey) return 0;
    return readAttemptState(storage, attemptKey(incidentKey)).count;
  }

  function isMessageDeliveryDecision(decision = {}) {
    return decision?.action === 'RETRY_MESSAGE_DELIVERY' ||
      String(decision?.reason || '').startsWith('message-delivery-timeout-');
  }

  function findMarker(root) {
    const nodes = [...(root.querySelectorAll?.('[role="alert"], [data-testid], main div, main p, main span, main') || [])];
    const matches = nodes
      .map(node => ({ node, text: visibleText(node).trim() }))
      .filter(row => row.text && row.text.length <= 700 && containsDeliveryTimeout(row.text))
      .sort((a, b) => a.text.length - b.text.length);
    return matches[0] || null;
  }
  function findAssociatedRetryButton(root, markerNode) {
    const candidates = [...(root.querySelectorAll?.('button') || [])]
      .filter(button => isRetryButton(button) && !button.disabled);
    if (!candidates.length) return null;

    if (typeof markerNode?.querySelectorAll === 'function') {
      const nested = [...markerNode.querySelectorAll('button')]
        .find(button => isRetryButton(button) && !button.disabled);
      if (nested) return nested;
    }

    let ancestor = markerNode?.parentElement;
    for (let depth = 0; ancestor && depth < 5; depth += 1, ancestor = ancestor.parentElement) {
      if (!containsDeliveryTimeout(visibleText(ancestor))) continue;
      const nested = [...(ancestor.querySelectorAll?.('button') || [])]
        .find(button => isRetryButton(button) && !button.disabled);
      if (nested) return nested;
    }

    return candidates.find(button => sameAlertRegion(markerNode, button)) || null;
  }

  function sameAlertRegion(markerNode, button) {
    if (!markerNode || !button) return false;
    const markerAlert = markerNode.closest?.('[role="alert"]');
    const buttonAlert = button.closest?.('[role="alert"]');
    if (markerAlert && buttonAlert) return markerAlert === buttonAlert;
    return false;
  }
  function isRetryButton(button) {
    const label = String(button?.innerText || button?.getAttribute?.('aria-label') || '').trim();
    return /^(retry|try again)$/i.test(label);
  }

  function incidentKeyFor(markerNode, markerText, turnNodes) {
    const id = messageId(markerNode);
    if (id) return 'message:' + id;
    const precedingUser = [...turnNodes].reverse().find(node => {
      const role = String(node?.getAttribute?.('data-message-author-role') || '').toLowerCase();
      return role === 'user' && !follows(markerNode, node);
    });
    const userId = messageId(precedingUser);
    if (userId) return 'user:' + userId;
    const userText = visibleText(precedingUser).slice(-500);
    return 'marker:' + simpleHash(markerText + '|' + userText);
  }

  function attemptKey(incidentKey) {
    const conversation = globalThis.location?.pathname || 'conversation';
    return ATTEMPT_PREFIX + conversation + ':' + (incidentKey || 'active');
  }

  function readAttemptState(storage, key) {
    try {
      const parsed = JSON.parse(storage?.getItem?.(key) || '{}');
      return {
        count: Math.max(0, Number(parsed.count || 0)),
        lastAt: Math.max(0, Number(parsed.lastAt || 0))
      };
    } catch {
      return { count: 0, lastAt: 0 };
    }
  }
  function isConversationTurn(node) {
    const role = String(node?.getAttribute?.('data-message-author-role') || '').toLowerCase();
    return role === 'user' || role === 'assistant';
  }

  function follows(marker, node) {
    if (!marker || !node || marker === node || typeof marker.compareDocumentPosition !== 'function') return false;
    return Boolean(marker.compareDocumentPosition(node) & 4);
  }

  function messageId(node) {
    return String(
      node?.getAttribute?.('data-message-id') ||
      node?.id ||
      node?.closest?.('[data-message-id]')?.getAttribute?.('data-message-id') ||
      ''
    );
  }

  function visibleText(node) {
    return String(node?.innerText ?? node?.textContent ?? '');
  }

  function simpleHash(value) {
    let hash = 2166136261;
    for (const character of String(value || '')) {
      hash ^= character.charCodeAt(0);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(36);
  }
  function inactive(reason, detail = {}) {
    return {
      active: false,
      timeoutMarkerPresent: false,
      retryVisible: false,
      incidentKey: '',
      retryButton: null,
      reason,
      ...detail
    };
  }

  function safeSessionStorage() {
    try { return globalThis.sessionStorage; } catch { return null; }
  }

  globalThis.ChatSentinelMessageDeliveryRecovery = Object.freeze({
    DELIVERY_TIMEOUT_TEXTS,
    MAX_ATTEMPTS,
    containsDeliveryTimeout,
    inspect,
    prepareAttempt,
    markAttempt,
    retryCount,
    isMessageDeliveryDecision
  });
})();
