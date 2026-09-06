(() => {
  const MAX_CONTROL_TOP = 280;
  const MAX_REGION_DEPTH = 4;
  const CHAT_LABEL = /^chat$/i;
  const WORK_LABEL = /^work$/i;

  function inspect(root = globalThis.document) {
    if (!root?.querySelectorAll) return inactive('document-unavailable');
    const controls = [...root.querySelectorAll('button,[role="tab"],[role="radio"]')]
      .filter(isVisible)
      .map(node => ({ node, label: controlLabel(node) }))
      .filter(row => row.label);
    const chats = controls.filter(row => CHAT_LABEL.test(row.label));
    const works = controls.filter(row => WORK_LABEL.test(row.label));
    for (const chat of chats) {
      for (const work of works) {
        const region = commonRegion(chat.node, work.node);
        if (!region || !isTopExperienceRegion(region, chat.node, work.node)) continue;
        return {
          detected: true,
          chatControl: chat.node,
          workControl: work.node,
          chatSelected: isSelected(chat.node),
          workSelected: isSelected(work.node),
          reason: 'chat-work-toggle-detected'
        };
      }
    }
    return inactive('chat-work-toggle-missing');
  }
  function ensureChat(root = globalThis.document) {
    const state = inspect(root);
    if (!state.detected) return { ok: true, changed: false, ...state };
    if (state.chatSelected && !state.workSelected) {
      return { ok: true, changed: false, ...state, reason: 'chat-already-selected' };
    }
    if (!isActionable(state.chatControl)) {
      return { ok: false, changed: false, ...state, reason: 'chat-control-not-actionable' };
    }
    state.chatControl.click();
    return { ok: true, changed: true, ...state, reason: 'switched-work-to-chat' };
  }

  function controlLabel(node) {
    return String(
      node?.getAttribute?.('aria-label') ||
      node?.getAttribute?.('data-value') ||
      node?.innerText ||
      node?.textContent ||
      ''
    ).replace(/\s+/g, ' ').trim();
  }

  function commonRegion(a, b) {
    const seen = new Set();
    let node = a;
    for (let depth = 0; node && depth <= MAX_REGION_DEPTH; depth += 1, node = node.parentElement) seen.add(node);
    node = b;
    for (let depth = 0; node && depth <= MAX_REGION_DEPTH; depth += 1, node = node.parentElement) {
      if (seen.has(node)) return node;
    }
    return null;
  }
  function isTopExperienceRegion(region, chat, work) {
    try {
      const top = Math.min(chat.getBoundingClientRect().top, work.getBoundingClientRect().top);
      if (!Number.isFinite(top) || top < -20 || top > MAX_CONTROL_TOP) return false;
      const text = String(region?.innerText || region?.textContent || '').replace(/\s+/g, ' ').trim();
      return /\bchat\b/i.test(text) && /\bwork\b/i.test(text) && text.length <= 180;
    } catch { return false; }
  }

  function isSelected(node) {
    const values = [
      node?.getAttribute?.('aria-selected'),
      node?.getAttribute?.('aria-checked'),
      node?.getAttribute?.('data-state'),
      node?.getAttribute?.('data-selected')
    ].map(value => String(value || '').toLowerCase());
    return values.includes('true') || values.includes('active') || values.includes('selected') || values.includes('checked');
  }

  function isActionable(node) {
    return Boolean(node && !node.disabled && String(node.getAttribute?.('aria-disabled') || '').toLowerCase() !== 'true' && isVisible(node));
  }

  function isVisible(node) {
    if (!node || node.hidden) return false;
    try {
      const rect = node.getBoundingClientRect();
      const style = globalThis.getComputedStyle?.(node);
      return rect.width > 0 && rect.height > 0 && style?.display !== 'none' && style?.visibility !== 'hidden';
    } catch { return false; }
  }

  function inactive(reason) {
    return { detected: false, chatControl: null, workControl: null, chatSelected: false, workSelected: false, reason };
  }

  globalThis.ChatSentinelChatExperienceGuard = Object.freeze({ inspect, ensureChat, controlLabel, isSelected });
})();
