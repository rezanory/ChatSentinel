const DEFAULT_WATCHDOG = 'http://127.0.0.1:4317';
const CLIENT_HEADERS = Object.freeze({
  'content-type': 'application/json',
  'x-chatsentinel-client': 'extension'
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type !== 'CHATSENTINEL_SIGNAL') return;
  forwardSignal(message, sender.tab?.id)
    .then(result => sendResponse(result))
    .catch(error => sendResponse({ ok: false, error: String(error) }));
  return true;
});

async function forwardSignal(signal, tabId) {
  const config = await conversationConfig(signal.conversationId);
  const payload = {
    ...signal,
    ...config,
    tabId,
    sideEffectRisk: await sideEffectRisk(signal.conversationId),
    checkpointFresh: await checkpointFresh(signal.conversationId),
    retryCount: await effectiveRetryCount(signal)
  };
  const base = watchdogBase(signal.url);

  const response = await fetch(`${base}/signal`, {
    method: 'POST',
    headers: CLIENT_HEADERS,
    body: JSON.stringify(payload)
  });
  const result = await response.json();
  if (!response.ok) return { ...result, execution: { executed: false, reason: 'watchdog-rejected' } };

  await recordDecision(signal.conversationId, result);
  const execution = await maybeAct(result, tabId, payload);
  return { ...result, execution };
}

async function maybeAct(result, tabId, payload) {
  if (!result?.decision || !tabId) return { executed: false, reason: 'decision-or-tab-missing' };
  const settings = await chrome.storage.local.get(['autoRecoveryEnabled']);
  const fixtureAuto = isFixtureAuto(payload.url);
  if (!settings.autoRecoveryEnabled && !fixtureAuto) {
    return { executed: false, reason: 'auto-recovery-disabled' };
  }

  if (result.decision.action === 'SAFE_RETRY') {
    await incrementRetryCount(payload.conversationId);
  }

  const execution = await chrome.tabs.sendMessage(tabId, {
    type: 'CHATSENTINEL_EXECUTE',
    decision: result.decision,
    context: {
      reconciliation: result.reconciliation,
      projectPath: result.projectPath,
      decision: result.decision,
      newChatUrl: fixtureAuto
        ? fixtureNewChatUrl(payload.url, payload.conversationId)
        : undefined
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
    [`decision:${conversationId}`]: { ...result, at: new Date().toISOString() }
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

async function effectiveRetryCount(signal) {
  const current = await retryCount(signal.conversationId);
  const stable = !signal.retryVisible &&
    !signal.connectionInterrupted &&
    !signal.conversationDead &&
    signal.state === 'IDLE' &&
    Number(signal.progressAgeMs || 0) < 60_000;
  if (stable && current > 0) {
    await chrome.storage.local.set({ [`retryCount:${signal.conversationId}`]: 0 });
    return 0;
  }
  return current;
}

async function incrementRetryCount(conversationId) {
  const key = `retryCount:${conversationId}`;
  const current = await retryCount(conversationId);
  await chrome.storage.local.set({ [key]: current + 1 });
}

async function conversationConfig(conversationId) {
  const projectKey = `projectPath:${conversationId}`;
  const operationKey = `operationClass:${conversationId}`;
  const stored = await chrome.storage.local.get([projectKey, operationKey]);
  return {
    projectPath: stored[projectKey] || undefined,
    operationClass: stored[operationKey] || undefined
  };
}

function watchdogBase(url) {
  if (typeof url !== 'string' || !url.startsWith('http://127.0.0.1:4320/')) return DEFAULT_WATCHDOG;
  try {
    const port = new URL(url).searchParams.get('watchdog');
    return /^\d{4,5}$/.test(port || '') ? `http://127.0.0.1:${port}` : DEFAULT_WATCHDOG;
  } catch {
    return DEFAULT_WATCHDOG;
  }
}

function isFixtureAuto(url) {
  try {
    return typeof url === 'string' &&
      url.startsWith('http://127.0.0.1:4320/') &&
      new URL(url).searchParams.get('auto') === '1';
  } catch {
    return false;
  }
}

function fixtureNewChatUrl(url, conversationId) {
  const fixture = new URL(url);
  const watchdog = fixture.searchParams.get('watchdog');
  const params = new URLSearchParams({
    auto: '1',
    cid: `${conversationId}-new`
  });
  if (watchdog) params.set('watchdog', watchdog);
  return `http://127.0.0.1:4320/newchat?${params}`;
}
