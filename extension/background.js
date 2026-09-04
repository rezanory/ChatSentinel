const WATCHDOG = 'http://127.0.0.1:4317';

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type !== 'CHATSENTINEL_SIGNAL') return;
  forwardSignal(message, sender.tab?.id)
    .then(result => sendResponse(result))
    .catch(error => sendResponse({ ok: false, error: String(error) }));
  return true;
});

async function forwardSignal(signal, tabId) {
  const payload = {
    ...signal,
    tabId,
    sideEffectRisk: await sideEffectRisk(signal.conversationId),
    checkpointFresh: await checkpointFresh(signal.conversationId)
  };

  const response = await fetch(`${WATCHDOG}/signal`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload)
  });

  const result = await response.json();
  await chrome.storage.local.set({
    [`decision:${signal.conversationId}`]: {
      ...result,
      at: new Date().toISOString()
    }
  });

  await maybeAct(result.decision, tabId);
  return result;
}

async function maybeAct(decision, tabId) {
  if (!decision || !tabId) return;
  if (decision.action === 'RELOAD_AND_RECHECK') {
    await chrome.tabs.reload(tabId);
  }
  // SAFE_RETRY / CONTINUE / NEW_CHAT remain advisory in v0.1.
  // Automated write-like UI actions are enabled only after reconciliation adapters land.
}

async function sideEffectRisk(conversationId) {
  const key = `sideEffectRisk:${conversationId}`;
  const stored = await chrome.storage.local.get(key);
  return stored[key] || 'unknown';
}

async function checkpointFresh(conversationId) {
  const key = `checkpointFresh:${conversationId}`;
  const stored = await chrome.storage.local.get(key);
  return Boolean(stored[key]);
}
