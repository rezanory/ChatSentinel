(() => {
  const DELIVERY_TIMEOUT_TEXTS = Object.freeze([
    'Message delivery timed out. Please try again.',
    'Message delivery timed out',
  ]);
  const ATTEMPT_PREFIX = 'chatsentinel:message-delivery:';
  const DEFAULT_COOLDOWN_MS = 5000;
  const MAX_ATTEMPTS = 2;
  const MAX_MARKER_TEXT_LENGTH = 700;
  const MAX_ASSOCIATION_REGION_TEXT_LENGTH = 1400;
  const MAX_ASSOCIATION_DEPTH = 8;
  const MAX_FALLBACK_ELEMENTS = 5000;

  function containsDeliveryTimeout(text) {
    const value = normalizeText(text).toLowerCase();
    return DELIVERY_TIMEOUT_TEXTS.some((marker) => value.includes(normalizeText(marker).toLowerCase()));
  }

  function inspect(root = globalThis.document) {
    if (!root) return inactive('no-document');
    const marker = findMarker(root);
    if (!marker) return inactive('marker-missing');

    const turnNodes = [...(root.querySelectorAll?.('[data-message-author-role]') || [])];
    const superseded = turnNodes.some((node) => isConversationTurn(node) && follows(marker.node, node));
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
      retryButton,
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
    storage.setItem(
      ticket.key,
      JSON.stringify({
        count: current.count + 1,
        lastAt: now,
      }),
    );
    return true;
  }

  function retryCount(incidentKey, storage = safeSessionStorage()) {
    if (!incidentKey) return 0;
    return readAttemptState(storage, attemptKey(incidentKey)).count;
  }

  function isMessageDeliveryDecision(decision = {}) {
    return (
      decision?.action === 'RETRY_MESSAGE_DELIVERY' ||
      String(decision?.reason || '').startsWith('message-delivery-timeout-')
    );
  }

  function findMarker(root) {
    const fastNodes = [
      ...(root.querySelectorAll?.('[role="alert"], [data-testid], main div, main p, main span, main') || []),
    ];
    const fastMatch = bestMarker(fastNodes);
    if (fastMatch) return fastMatch;

    const searchRoot = root.body || root.documentElement || root;
    if (!containsDeliveryTimeout(visibleText(searchRoot))) return null;

    const textMatch = markerFromTextNodes(root, searchRoot);
    if (textMatch) return textMatch;

    const fallbackNodes = [...(searchRoot.querySelectorAll?.('div, p, span, section') || [])].slice(
      0,
      MAX_FALLBACK_ELEMENTS,
    );
    return bestMarker(fallbackNodes);
  }

  function markerFromTextNodes(root, searchRoot) {
    const documentLike =
      typeof root?.createTreeWalker === 'function'
        ? root
        : root?.ownerDocument || searchRoot?.ownerDocument || globalThis.document;
    if (typeof documentLike?.createTreeWalker !== 'function') return null;

    let walker;
    try {
      walker = documentLike.createTreeWalker(searchRoot, 4);
    } catch {
      return null;
    }

    const matches = [];
    let current;
    let scanned = 0;
    while ((current = walker.nextNode()) && scanned < MAX_FALLBACK_ELEMENTS * 4) {
      scanned += 1;
      if (!containsDeliveryTimeout(current.nodeValue || current.textContent || '')) continue;
      const parent = current.parentElement || current.parentNode;
      if (parent) matches.push(parent);
    }
    return bestMarker(matches);
  }

  function bestMarker(nodes) {
    const matches = [...new Set(nodes)]
      .map((node) => ({ node, text: normalizeText(visibleText(node)) }))
      .filter((row) => row.text && row.text.length <= MAX_MARKER_TEXT_LENGTH && containsDeliveryTimeout(row.text))
      .sort((a, b) => a.text.length - b.text.length);
    return matches[0] || null;
  }

  function findAssociatedRetryButton(root, markerNode) {
    const candidates = [...(root.querySelectorAll?.('button') || [])].filter(isActionableRetryButton);
    if (!candidates.length) return null;

    if (typeof markerNode?.querySelectorAll === 'function') {
      const nested = [...markerNode.querySelectorAll('button')].find(isActionableRetryButton);
      if (nested) return nested;
    }

    const associated = candidates
      .map((button) => ({ button, score: associationScore(markerNode, button) }))
      .filter((row) => Number.isFinite(row.score))
      .sort((a, b) => a.score - b.score);
    if (associated.length) return associated[0].button;

    return candidates.find((button) => sameAlertRegion(markerNode, button)) || null;
  }

  function associationScore(markerNode, button) {
    if (!markerNode || !button) return Number.POSITIVE_INFINITY;
    const markerAncestors = new Map();
    let current = markerNode;
    for (let depth = 0; current && depth <= MAX_ASSOCIATION_DEPTH; depth += 1, current = current.parentElement) {
      markerAncestors.set(current, depth);
    }

    current = button;
    for (
      let buttonDepth = 0;
      current && buttonDepth <= MAX_ASSOCIATION_DEPTH;
      buttonDepth += 1, current = current.parentElement
    ) {
      if (!markerAncestors.has(current)) continue;
      const markerDepth = markerAncestors.get(current);
      const distance = markerDepth + buttonDepth;
      if (distance > MAX_ASSOCIATION_DEPTH) return Number.POSITIVE_INFINITY;
      const regionText = normalizeText(visibleText(current));
      if (!containsDeliveryTimeout(regionText)) return Number.POSITIVE_INFINITY;
      if (regionText.length > MAX_ASSOCIATION_REGION_TEXT_LENGTH) return Number.POSITIVE_INFINITY;
      return distance;
    }
    return Number.POSITIVE_INFINITY;
  }

  function sameAlertRegion(markerNode, button) {
    if (!markerNode || !button) return false;
    const markerAlert = markerNode.closest?.('[role="alert"]');
    const buttonAlert = button.closest?.('[role="alert"]');
    if (markerAlert && buttonAlert) return markerAlert === buttonAlert;
    return false;
  }

  function isActionableRetryButton(button) {
    if (!isRetryButton(button) || button?.disabled) return false;
    if (String(button?.getAttribute?.('aria-disabled') || '').toLowerCase() === 'true') return false;
    if (String(button?.getAttribute?.('aria-hidden') || '').toLowerCase() === 'true') return false;
    if (button?.hidden === true || button?.hasAttribute?.('hidden')) return false;

    try {
      const style = globalThis.getComputedStyle?.(button);
      if (style && (style.display === 'none' || style.visibility === 'hidden')) return false;
    } catch {}

    try {
      if (
        typeof button?.getClientRects === 'function' &&
        button.isConnected !== false &&
        button.getClientRects().length === 0
      )
        return false;
    } catch {}
    return true;
  }

  function isRetryButton(button) {
    const labels = [button?.innerText, button?.textContent, button?.getAttribute?.('aria-label')]
      .map(normalizeText)
      .filter(Boolean);
    return labels.some((label) => /^(retry|try again)$/i.test(label));
  }

  function incidentKeyFor(markerNode, markerText, turnNodes) {
    const id = messageId(markerNode);
    if (id) return 'message:' + id;
    const precedingUser = [...turnNodes].reverse().find((node) => {
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
        lastAt: Math.max(0, Number(parsed.lastAt || 0)),
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
        '',
    );
  }

  function visibleText(node) {
    return String(node?.innerText ?? node?.textContent ?? '');
  }

  function normalizeText(value) {
    return String(value || '')
      .replace(/\s+/g, ' ')
      .trim();
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
      ...detail,
    };
  }

  function safeSessionStorage() {
    try {
      return globalThis.sessionStorage;
    } catch {
      return null;
    }
  }

  globalThis.ChatSentinelMessageDeliveryRecovery = Object.freeze({
    DELIVERY_TIMEOUT_TEXTS,
    MAX_ATTEMPTS,
    containsDeliveryTimeout,
    inspect,
    prepareAttempt,
    markAttempt,
    retryCount,
    isMessageDeliveryDecision,
  });
})();
