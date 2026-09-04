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
    checkpointFresh: await checkpointFresh(signal.conversationId),
    retryCount: await retryCount(signal.conversationId)
  };

  const response = await fetch(`${WATCHDOG}/signal`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload)
  });

  const result = await response.json();
  await recordDecision(signal.conversationId, result);
  const execution = await maybeAct(result, tabId, payload);
  return { ...result, execution };
}
async function maybeAct(result, tabId, payload) {
  if (!result?.decision || !tabId) return { executed: false, reason: 'decision-or-tab-missing' };
  const settings = await chrome.storage.local.get(['autoRecoveryEnabled']);
  const fixtureAuto = payload.url?.startsWith('http://127.0.0.1:4320/') && new URL(payload.url).searchParams.get('auto') === '1';
  if (!settings.autoRecoveryEnabled && !fixtureAuto) return { executed: false, reason: 'auto-recovery-disabled' };

  if (result.decision.action === 'SAFE_RETRY') {
    await incrementRetryCount(payload.conversationId);
  }

  const execution = await chrome.tabs.sendMessage(tabId, {
    type: 'CHATSENTINEL_EXECUTE',
    decision: result.decision,
    context: {
      reconciliation: result.reconciliation,
      projectPath: result.projectPath,
      decision: result.decision
    }
  }).catch(error => ({ ok: false, error: String(error) }));

  await chrome.storage.local.set({
    [`execution:${payload.conversationId}`]: {
      ...execution,
      decision: result.decision,
      tabId,
      at: new Date().toISOString()
    }
  });
  return execution;
}

async function recordDecision(conversationId, result) {
  await chrome.storage.local.set({
    [`decision:${conversationId}`]: {
      ...result,
      at: new Date().toISOString()
    }
  });
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

async function retryCount(conversationId) {
  const key = `retryCount:${conversationId}`;
  const stored = await chrome.storage.local.get(key);
  return Number(stored[key] || 0);
}

async function incrementRetryCount(conversationId) {
  const key = `retryCount:${conversationId}`;
  const current = await retryCount(conversationId);
  await chrome.storage.local.set({ [key]: current + 1 });
}
