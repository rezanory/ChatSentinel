(() => {
  async function executeDecision(decision, context = {}) {
    if (!decision?.action) return { ok: false, reason: 'decision-missing' };
    switch (decision.action) {
      case 'WAIT':
      case 'ESCALATE':
        return { ok: true, action: decision.action, executed: false };
      case 'RELOAD_AND_RECHECK':
        location.reload();
        return { ok: true, action: decision.action, executed: true };
      case 'SAFE_RETRY':
        return clickVisibleButton(/retry|try again/i, 'retry');
      case 'CONTINUE_SAME_CHAT':
        return sendPrompt(context.continuePrompt || defaultContinuePrompt(context));
      case 'CONTINUE_NEW_CHAT':
        return createNewChatAndContinue(context);
      default:
        return { ok: false, reason: 'unknown-action', action: decision.action };
    }
  }

  function defaultContinuePrompt(context) {
    const r = context.reconciliation || {};
    const evidence = r.remoteHead || r.head || 'unknown';
    return `ادامه بده. ابتدا وضعیت واقعی پروژه را reconcile کن، کارهای انجام‌شده را تکرار نکن و از آخرین checkpoint معتبر ادامه بده. آخرین SHA شناخته‌شده: ${evidence}`;
  }
  function clickVisibleButton(pattern, label) {
    const buttons = [...document.querySelectorAll('button')];
    const button = buttons.find(item => {
      const value = (item.innerText || item.getAttribute('aria-label') || '').trim();
      return pattern.test(value) && isVisible(item) && !item.disabled;
    });
    if (!button) return { ok: false, reason: `${label}-button-not-found` };
    button.click();
    return { ok: true, action: label, executed: true };
  }

  function sendPrompt(prompt) {
    const composer = findComposer();
    if (!composer) return { ok: false, reason: 'composer-not-found' };
    composer.focus();
    setComposerText(composer, prompt);
    const send = findSendButton();
    if (!send) return { ok: false, reason: 'send-button-not-found' };
    send.click();
    return { ok: true, action: 'send-prompt', executed: true };
  }

  async function createNewChatAndContinue(context) {
    const prompt = context.newChatPrompt || defaultNewChatPrompt(context);
    sessionStorage.setItem('chatsentinel:pendingPrompt', prompt);
    location.assign('https://chatgpt.com/');
    return { ok: true, action: 'new-chat', executed: true };
  }
  function defaultNewChatPrompt(context) {
    const r = context.reconciliation || {};
    return [
      'ادامه پروژه را از checkpoint معتبر ادامه بده.',
      'قبل از هر کاری GitHub/source-of-truth را reconcile کن.',
      'کارهای انجام‌شده را تکرار نکن.',
      `projectPath: ${context.projectPath || 'unknown'}`,
      `branch: ${r.branch || 'unknown'}`,
      `HEAD: ${r.head || 'unknown'}`,
      `remoteHead: ${r.remoteHead || 'unknown'}`,
      `recoveryReason: ${context.decision?.reason || 'conversation-recovery'}`
    ].join('\n');
  }

  function consumePendingPrompt() {
    const prompt = sessionStorage.getItem('chatsentinel:pendingPrompt');
    if (prompt) sessionStorage.removeItem('chatsentinel:pendingPrompt');
    return prompt;
  }

  function sendPendingPrompt(prompt) {
    return sendPrompt(prompt);
  }

  function findComposer() {
    return document.querySelector('#prompt-textarea, textarea, [contenteditable="true"]');
  }
  function findSendButton() {
    return [...document.querySelectorAll('button')].find(button => {
      const label = (button.getAttribute('aria-label') || button.innerText || '').trim();
      return /send|ارسال/i.test(label) && isVisible(button) && !button.disabled;
    });
  }

  function setComposerText(element, text) {
    if ('value' in element) {
      const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(element), 'value')?.set;
      setter ? setter.call(element, text) : (element.value = text);
      element.dispatchEvent(new Event('input', { bubbles: true }));
      return;
    }
    element.textContent = text;
    element.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
  }

  function isVisible(element) {
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
  }

  window.ChatSentinelActuator = { executeDecision, consumePendingPrompt, sendPendingPrompt };
})();
