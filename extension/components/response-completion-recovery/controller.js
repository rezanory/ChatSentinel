(() => {
  const INTERRUPTION_TEXTS = Object.freeze([
    'Connection interrupted. Waiting for the complete answer',
    'Something went wrong',
    'There was an error generating a response'
  ]);
  const ATTEMPT_PREFIX = 'chatsentinel:response-completion:';
  const DEFAULT_COOLDOWN_MS = 30000;

  function containsInterruption(text) {
    const value = String(text || '');
    return INTERRUPTION_TEXTS.some(marker => value.includes(marker));
  }

  function isActiveInterruptionTimeline(events = []) {
    const rows = Array.isArray(events) ? events : [];
    let interruptedIndex = -1;
    for (let index = rows.length - 1; index >= 0; index -= 1) {
      if (rows[index]?.interrupted === true) {
        interruptedIndex = index;
        break;
      }
    }
    if (interruptedIndex < 0) return false;
    for (let index = interruptedIndex + 1; index < rows.length; index += 1) {
      const row = rows[index] || {};
      if (row.role === 'user') return false;
      if (row.role === 'assistant' && !row.interrupted && String(row.text || '').trim()) return false;
    }
    return true;
  }

  function inspect(root = globalThis.document) {
    if (!root) return { active: false, source: 'no-document', events: [] };
    const turnNodes = [...(root.querySelectorAll?.('[data-message-author-role]') || [])];
    if (turnNodes.length) {
      const events = turnNodes.map((node, index) => {
        const text = visibleText(node);
        return {
          index,
          role: String(node.getAttribute?.('data-message-author-role') || '').toLowerCase(),
          text,
          interrupted: containsInterruption(text),
          messageId: messageId(node)
        };
      });
      const interrupted = findLastInterrupted(events);
      if (interrupted) {
        const active = isActiveInterruptionTimeline(events);
        return {
          active,
          source: 'turn-timeline',
          events,
          interruptedIndex: interrupted.index,
          messageId: interrupted.messageId || '',
          incidentKey: active ? incidentKeyFromEvents(events, interrupted) : ''
        };
      }

      const marker = findPageMarker(root);
      if (marker) {
        const active = !turnNodes.some(node => {
          const role = String(node.getAttribute?.('data-message-author-role') || '').toLowerCase();
          return (role === 'user' || role === 'assistant') && follows(marker.node, node);
        });
        return {
          active,
          source: 'page-marker',
          events,
          interruptedIndex: -1,
          messageId: messageId(marker.node),
          incidentKey: active ? markerIncidentKey(marker) : ''
        };
      }

      return { active: false, source: 'turn-timeline', events, interruptedIndex: -1, messageId: '', incidentKey: '' };
    }

    const bodyText = visibleText(root.body || root.documentElement || root);
    const active = containsInterruption(bodyText);
    return {
      active,
      source: 'page-fallback',
      events: [],
      interruptedIndex: active ? 0 : -1,
      messageId: '',
      incidentKey: active ? 'fallback:' + simpleHash(bodyText.slice(-1200)) : ''
    };
  }

  function buildContinuationPrompt(context = {}) {
    const reconciliation = context.reconciliation || {};
    const lines = [
      'Your previous response was interrupted before it finished.',
      'Continue that same response from exactly where it stopped and deliver the complete remaining answer now.',
      'Do not restart, summarize, or repeat text that was already delivered.',
      'If the interrupted work used tools or changed Git, files, browser state, or any external state, first reconcile the current durable state/source of truth and continue only unfinished work. Do not repeat completed side effects.',
      'Do not stop at a progress update. Finish the requested work and then provide the complete final answer.'
    ];
    const evidence = [
      ['branch', reconciliation.branch],
      ['HEAD', reconciliation.head],
      ['remoteHead', reconciliation.remoteHead]
    ].filter(([, value]) => value);
    if (evidence.length) {
      lines.push('Durable checkpoint evidence before continuation:');
      for (const [label, value] of evidence) lines.push(label + ': ' + value);
    }
    return lines.join('\n');
  }

  function isStreamInterruptionDecision(decision = {}) {
    return decision?.action === 'CONTINUE_SAME_CHAT' &&
      String(decision?.reason || '').startsWith('stream-interrupted-');
  }

  function prepareAttempt(root = globalThis.document, storage = safeSessionStorage(), now = Date.now(), cooldownMs = DEFAULT_COOLDOWN_MS) {
    const observation = inspect(root);
    if (!observation.active) return { allowed: false, reason: 'no-active-interruption', observation };
    const conversation = globalThis.location?.pathname || 'conversation';
    const key = ATTEMPT_PREFIX + conversation + ':' + (observation.incidentKey || 'active');
    const previous = Number(storage?.getItem?.(key) || 0);
    const ageMs = previous > 0 ? Math.max(0, now - previous) : Infinity;
    if (Number.isFinite(ageMs) && ageMs < Math.max(1000, Number(cooldownMs) || DEFAULT_COOLDOWN_MS)) {
      return { allowed: false, deduplicated: true, reason: 'attempt-cooldown', key, ageMs, observation };
    }
    return { allowed: true, key, observation };
  }

  function markAttempt(ticket, storage = safeSessionStorage(), now = Date.now()) {
    if (!ticket?.key || !storage?.setItem) return false;
    ticket.reservedAt = Number(now);
    storage.setItem(ticket.key, String(ticket.reservedAt));
    return true;
  }

  function clearAttempt(ticket, storage = safeSessionStorage()) {
    if (!ticket?.key || !storage?.getItem || !storage?.removeItem) return false;
    const current = Number(storage.getItem(ticket.key) || 0);
    if (ticket.reservedAt && current && current !== Number(ticket.reservedAt)) return false;
    storage.removeItem(ticket.key);
    return true;
  }

  function findPageMarker(root) {
    const nodes = [...(root.querySelectorAll?.('[role="alert"], [data-testid], main p, main div, main span, main') || [])];
    const matches = nodes
      .map(node => ({ node, text: visibleText(node).trim() }))
      .filter(row => row.text && row.text.length <= 700 && containsInterruption(row.text))
      .sort((a, b) => a.text.length - b.text.length);
    return matches[0] || null;
  }

  function follows(marker, node) {
    if (!marker || !node || marker === node || typeof marker.compareDocumentPosition !== 'function') return false;
    return Boolean(marker.compareDocumentPosition(node) & 4);
  }

  function markerIncidentKey(marker) {
    const id = messageId(marker?.node);
    return id ? 'message:' + id : 'marker:' + simpleHash(marker?.text || '');
  }

  function findLastInterrupted(events) {
    for (let index = events.length - 1; index >= 0; index -= 1) {
      if (events[index]?.interrupted) return events[index];
    }
    return null;
  }

  function incidentKeyFromEvents(events, interrupted) {
    if (!interrupted) return '';
    if (interrupted.messageId) return 'message:' + interrupted.messageId;
    const userCount = events.filter(row => row.role === 'user').length;
    const assistantCount = events.filter(row => row.role === 'assistant').length;
    return 'timeline:' + userCount + ':' + assistantCount + ':' + interrupted.index;
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

  function safeSessionStorage() {
    try { return globalThis.sessionStorage; } catch { return null; }
  }

  globalThis.ChatSentinelResponseCompletion = Object.freeze({
    INTERRUPTION_TEXTS,
    containsInterruption,
    isActiveInterruptionTimeline,
    inspect,
    buildContinuationPrompt,
    isStreamInterruptionDecision,
    prepareAttempt,
    markAttempt,
    clearAttempt
  });
})();
