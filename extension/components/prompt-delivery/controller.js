(() => {
  const PROMPT_QUERY_KEYS = new Set(['prompt', 'prompt-textarea', 'message', 'text']);
  const READY_TIMEOUT_MS = 3000;
  const POLL_MS = 50;

  function normalizeText(value) {
    return String(value || '').replace(/\s+/gu, ' ').trim();
  }

  function containsPromptQuery(value) {
    try {
      const url = new URL(String(value || ''), globalThis.location?.href || 'https://chatgpt.com/');
      for (const key of url.searchParams.keys()) {
        if (PROMPT_QUERY_KEYS.has(String(key).toLowerCase())) return true;
      }
      return false;
    } catch {
      return /[?&](?:prompt|prompt-textarea|message|text)=/iu.test(String(value || ''));
    }
  }

  function findComposer(root = globalThis.document) {
    return root?.querySelector?.('#prompt-textarea') ||
      root?.querySelector?.('textarea') ||
      root?.querySelector?.('[contenteditable="true"][data-lexical-editor="true"]') ||
      root?.querySelector?.('[contenteditable="true"]') || null;
  }

  function composerText(element) {
    if (!element) return '';
    if ('value' in element) return String(element.value || '');
    return String(element.innerText || element.textContent || '');
  }

  function isVisible(element) {
    if (!element) return false;
    const rect = element.getBoundingClientRect?.();
    if (rect && (!rect.width || !rect.height)) return false;
    const style = globalThis.getComputedStyle?.(element);
    return !style || (style.visibility !== 'hidden' && style.display !== 'none');
  }

  function findReadySendButton(root = globalThis.document) {
    const selectors = [
      'button[data-testid="send-button"]',
      'button[aria-label="Send prompt"]',
      'button[aria-label="Send message"]',
      'button[type="button"][aria-label="Send"]',
      'button[type="button"][aria-label="ارسال"]'
    ];
    for (const selector of selectors) {
      const button = root?.querySelector?.(selector);
      if (button && !button.disabled && isVisible(button)) return button;
    }
    return null;
  }

  function dispatchInput(element, text) {
    try {
      element.dispatchEvent(new InputEvent('beforeinput', {
        bubbles: true, cancelable: true, inputType: 'insertText', data: text
      }));
    } catch {}
    try {
      element.dispatchEvent(new InputEvent('input', {
        bubbles: true, inputType: 'insertText', data: text
      }));
    } catch {
      element.dispatchEvent?.(new Event('input', { bubbles: true }));
    }
    try { element.dispatchEvent(new Event('change', { bubbles: true })); } catch {}
  }

  function setTextInput(element, text) {
    let prototype = Object.getPrototypeOf(element);
    let setter = null;
    while (prototype && !setter) {
      setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set || null;
      prototype = Object.getPrototypeOf(prototype);
    }
    setter ? setter.call(element, text) : (element.value = text);
    dispatchInput(element, text);
    return 'native-value-setter';
  }

  function setContentEditable(element, text, root = globalThis.document) {
    element.focus?.();
    const doc = element.ownerDocument || root;
    let method = 'contenteditable-input-event';
    try {
      const selection = doc.defaultView?.getSelection?.() || globalThis.getSelection?.();
      const range = doc.createRange?.();
      if (selection && range) {
        range.selectNodeContents(element);
        selection.removeAllRanges();
        selection.addRange(range);
      }
      if (typeof doc.execCommand === 'function' && doc.execCommand('insertText', false, text)) {
        method = 'contenteditable-exec-command';
      }
    } catch {}
    if (normalizeText(composerText(element)) !== normalizeText(text)) {
      element.textContent = text;
      dispatchInput(element, text);
      method = 'contenteditable-input-event';
    }
    return method;
  }

  async function waitForReady(root, composer, prompt, timeoutMs) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const accepted = normalizeText(composerText(composer)) === normalizeText(prompt);
      const button = accepted ? findReadySendButton(root) : null;
      if (button) return button;
      await new Promise(resolve => setTimeout(resolve, POLL_MS));
    }
    return null;
  }

  async function prepare(root = globalThis.document, prompt, options = {}) {
    const text = String(prompt || '');
    if (!text.trim()) return { ok: false, reason: 'prompt-required' };
    const composer = findComposer(root);
    if (!composer) return { ok: false, reason: 'composer-not-found' };
    composer.focus?.();
    const method = 'value' in composer
      ? setTextInput(composer, text)
      : setContentEditable(composer, text, root);
    const sendButton = await waitForReady(
      root, composer, text, Math.max(250, Number(options.timeoutMs || READY_TIMEOUT_MS))
    );
    if (!sendButton) {
      return {
        ok: false,
        reason: 'composer-state-not-accepted',
        method,
        composerText: composerText(composer).slice(0, 500)
      };
    }
    if (containsPromptQuery(globalThis.location?.href)) {
      return { ok: false, reason: 'prompt-url-contaminated-before-send', method };
    }
    return { ok: true, composer, sendButton, prompt: text, method };
  }

  function click(ticket) {
    if (!ticket?.ok || !ticket.sendButton) return { ok: false, reason: 'prompt-not-prepared' };
    ticket.sendButton.click();
    return { ok: true, clicked: true, method: ticket.method };
  }

  function promptMatchesTurn(prompt, turnText) {
    const expected = normalizeText(prompt);
    const actual = normalizeText(turnText);
    if (!expected || !actual) return false;
    if (actual === expected) return true;
    if (expected.length < 320) return false;
    return actual.includes(expected.slice(0, 220)) && actual.includes(expected.slice(-100));
  }

  function inspect(root = globalThis.document, prompt = '', url = globalThis.location?.href || '') {
    const contaminatedUrl = containsPromptQuery(url);
    const userTurns = [...(root?.querySelectorAll?.('[data-message-author-role="user"]') || [])];
    const userTurnMatched = userTurns.some(node => promptMatchesTurn(
      prompt, node.innerText || node.textContent || ''
    ));
    const composer = findComposer(root);
    return {
      ok: true,
      confirmed: !contaminatedUrl && userTurnMatched,
      userTurnMatched,
      contaminatedUrl,
      composerEmpty: !normalizeText(composerText(composer)),
      userTurnCount: userTurns.length,
      url: String(url || '')
    };
  }

  globalThis.ChatSentinelPromptDelivery = Object.freeze({
    normalizeText,
    containsPromptQuery,
    findComposer,
    findReadySendButton,
    prepare,
    click,
    inspect,
    promptMatchesTurn
  });
})();
