(() => {
  const HOST_ID = 'chatsentinel-project-console-host';
  const BUTTON_ID = 'chatsentinel-runtime-recovery';
  const DRAFT_KEY = 'chatsentinel:offline-recovery:draft';
  const STATUS_KEY = 'chatsentinel:offline-recovery:last-status';
  const REPAIR_COMMAND = 'powershell -ExecutionPolicy Bypass -File C:\\ChatSentinel\\scripts\\recover-runtime.ps1';

  function classify(runtimeAlive, health) {
    if (!runtimeAlive) return { state: 'extension-disconnected', recoverableByReload: true };
    if (health?.ok) return { state: 'online', recoverableByReload: false };
    const reason = String(health?.error || health?.reason || 'watchdog-offline');
    return { state: reason.includes('origin-mismatch') ? 'pairing-mismatch' : 'watchdog-offline', recoverableByReload: false };
  }

  function statusLabel(status) {
    if (status?.state === 'online') return status?.health?.version ? `v${status.health.version} online` : 'online';
    if (status?.state === 'extension-disconnected') return 'extension disconnected';
    if (status?.state === 'pairing-mismatch') return 'pairing mismatch';
    return 'watchdog offline';
  }

  function renderStatus(status) {
    const shadow = document.getElementById(HOST_ID)?.shadowRoot;
    const health = shadow?.getElementById('health');
    const footer = shadow?.getElementById('footerVersion');
    const label = statusLabel(status);
    if (health) {
      health.textContent = label;
      health.className = status?.state === 'online' ? 'badge ok' : 'badge bad';
    }
    if (footer && status?.state !== 'online') footer.textContent = label;
    return label;
  }

  function isGenerationRunning(root = document) {
    return [...root.querySelectorAll('button')].some(button => {
      const label = `${button.getAttribute('aria-label') || ''} ${button.textContent || ''}`.toLowerCase();
      return /stop generating|stop responding|stop response/.test(label);
    });
  }

  function composer(root = document) {
    return root.querySelector('#prompt-textarea, textarea, [contenteditable="true"]');
  }

  function composerText(element) {
    if (!element) return '';
    if ('value' in element) return String(element.value || '');
    return String(element.innerText || element.textContent || '');
  }

  function preserveDraft(root = document, storage = sessionStorage) {
    const text = composerText(composer(root));
    if (!text.trim()) return false;
    try { storage.setItem(DRAFT_KEY, text); return true; } catch { return false; }
  }

  function restoreDraft(root = document, storage = sessionStorage) {
    let text = '';
    try { text = storage.getItem(DRAFT_KEY) || ''; } catch { return false; }
    if (!text) return false;
    const target = composer(root);
    if (!target || composerText(target).trim()) return false;
    if ('value' in target) target.value = text;
    else target.textContent = text;
    try { target.dispatchEvent(new Event('input', { bubbles: true })); } catch {}
    try { storage.removeItem(DRAFT_KEY); } catch {}
    return true;
  }

  async function diagnose() {
    const guard = globalThis.ChatSentinelRuntimeContext;
    const runtimeAlive = Boolean(guard?.isAlive?.());
    if (!runtimeAlive) return classify(false, null);
    const health = await guard.sendMessage({
      type: 'CHATSENTINEL_API', route: '/health', method: 'GET', pageUrl: location.href
    }).catch(error => ({ ok: false, error: String(error) }));
    return { ...classify(true, health), health };
  }

  async function recover(root = document) {
    const status = await diagnose();
    renderStatus(status);
    try { sessionStorage.setItem(STATUS_KEY, JSON.stringify({ ...status, at: new Date().toISOString() })); } catch {}
    if (status.state === 'online') return { ok: true, action: 'none', state: status.state };
    if (status.state === 'extension-disconnected') {
      if (isGenerationRunning(root)) return { ok: false, action: 'wait', state: status.state, reason: 'response-running' };
      preserveDraft(root);
      location.reload();
      return { ok: true, action: 'reload-tab', state: status.state };
    }
    if (status.state === 'watchdog-offline') {
      try { await navigator.clipboard.writeText(REPAIR_COMMAND); } catch {}
      try { chrome.runtime.openOptionsPage(); } catch {}
      return { ok: false, action: 'open-repair', state: status.state, repairCommand: REPAIR_COMMAND };
    }
    try { chrome.runtime.openOptionsPage(); } catch {}
    return { ok: false, action: 'open-repair', state: status.state };
  }

  function buttonLabel(status) {
    if (status.state === 'online') return 'Connected · Check';
    if (status.state === 'extension-disconnected') return 'Reconnect ChatSentinel';
    if (status.state === 'pairing-mismatch') return 'Repair pairing';
    return 'Repair ChatSentinel';
  }

  function installButton() {
    const host = document.getElementById(HOST_ID);
    const shadow = host?.shadowRoot;
    const header = shadow?.querySelector('.header');
    if (!header || shadow.getElementById(BUTTON_ID)) return false;
    const button = document.createElement('button');
    button.id = BUTTON_ID;
    button.textContent = 'Check connection';
    button.title = 'Diagnose and recover ChatSentinel connectivity';
    button.addEventListener('click', async () => {
      button.disabled = true;
      button.textContent = 'Checking…';
      const result = await recover(document);
      if (result.action === 'wait') {
        button.textContent = 'Response running';
        button.disabled = false;
        return;
      }
      if (result.action === 'open-repair') {
        button.textContent = 'Repair command copied';
        button.disabled = false;
        return;
      }
      if (result.action === 'none') {
        button.textContent = 'Connected';
        setTimeout(() => { button.disabled = false; button.textContent = 'Connected · Check'; }, 1500);
      }
    });
    header.insertBefore(button, shadow.getElementById('close'));
    diagnose().then(status => {
      renderStatus(status);
      button.textContent = buttonLabel(status);
      button.disabled = false;
    }).catch(() => {
      renderStatus({ state: 'extension-disconnected' });
      button.textContent = 'Reconnect ChatSentinel';
      button.disabled = false;
    });
    return true;
  }

  function boot() {
    restoreDraft();
    installButton();
    const observer = new MutationObserver(() => {
      restoreDraft();
      installButton();
      const host = document.getElementById(HOST_ID);
      if (host?.shadowRoot?.getElementById(BUTTON_ID)) {
        let pending = '';
        try { pending = sessionStorage.getItem(DRAFT_KEY) || ''; } catch {}
        if (!pending) observer.disconnect();
      }
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
  }

  globalThis.ChatSentinelOfflineRecovery = Object.freeze({
    HOST_ID, BUTTON_ID, DRAFT_KEY, STATUS_KEY, REPAIR_COMMAND,
    classify, statusLabel, renderStatus, isGenerationRunning, preserveDraft, restoreDraft,
    diagnose, recover, buttonLabel, installButton
  });

  if (globalThis.document?.documentElement) boot();
})();
