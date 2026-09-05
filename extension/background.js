importScripts('session-snapshot-store.js', 'session-restore-controller.js');

const DEFAULT_WATCHDOG = 'http://127.0.0.1:4317';
const CLIENT_HEADERS = Object.freeze({
  'content-type': 'application/json',
  'x-chatsentinel-client': 'extension'
});
const sessionSnapshotStore = new ChatSentinelSessionSnapshots.SessionSnapshotStore({ storage: chrome.storage.local });
const sessionRestoreController = new ChatSentinelSessionRestore.SessionRestoreController({
  chromeApi: chrome,
  snapshotStore: sessionSnapshotStore,
  apiRequest,
  onError: error => console.warn('ChatSentinel session restore:', error)
});
globalThis.sessionSnapshotStore = sessionSnapshotStore;
globalThis.sessionRestoreController = sessionRestoreController;

chrome.action.onClicked.addListener(tab => togglePanelInTab(tab));
chrome.tabs.onRemoved.addListener((tabId, removeInfo) => {
  chrome.storage.local.remove(`pendingProject:${tabId}`).catch(() => {});
  if (!removeInfo?.isWindowClosing) {
    apiRequest('/projects/detach', 'POST', { conversationId: `tab:${tabId}`, forget: true }).catch(() => {});
  }
  sessionRestoreController.scheduleCaptureAll(removeInfo?.isWindowClosing ? 'window-closing' : 'tab-removed');
});
chrome.runtime.onStartup.addListener(() => {
  sessionRestoreController.restoreAfterBrowserRestart()
    .then(() => sessionRestoreController.captureAllProjects('post-startup').catch(() => {}))
    .catch(error => console.warn('ChatSentinel startup restore:', error));
});
chrome.tabs.onUpdated.addListener((_tabId, changeInfo) => {
  if (changeInfo.url || changeInfo.title || changeInfo.pinned !== undefined || changeInfo.groupId !== undefined) {
    sessionRestoreController.scheduleCaptureAll('tab-updated');
  }
});
chrome.tabs.onMoved.addListener(() => sessionRestoreController.scheduleCaptureAll('tab-moved'));
chrome.tabs.onAttached.addListener(() => sessionRestoreController.scheduleCaptureAll('tab-attached'));
chrome.tabs.onDetached.addListener(() => sessionRestoreController.scheduleCaptureAll('tab-detached'));
chrome.tabGroups.onCreated.addListener(() => sessionRestoreController.scheduleCaptureAll('group-created'));
chrome.tabGroups.onUpdated.addListener(() => sessionRestoreController.scheduleCaptureAll('group-updated'));
chrome.tabGroups.onMoved.addListener(() => sessionRestoreController.scheduleCaptureAll('group-moved'));

async function togglePanelInTab(tab) {
  if (!tab?.id || !isChatGptUrl(tab.url)) return { ok: false, error: 'chatgpt-tab-required' };
  let response = await chrome.tabs.sendMessage(tab.id, { type: 'CHATSENTINEL_TOGGLE_PANEL' }).catch(() => null);
  if (response?.ok) return response;
  await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    files: ['identity.js', 'actuator.js', 'content.js', 'project-console.js']
  });
  response = await chrome.tabs.sendMessage(tab.id, { type: 'CHATSENTINEL_TOGGLE_PANEL' }).catch(error => ({ ok: false, error: String(error) }));
  return response || { ok: false, error: 'panel-toggle-failed' };
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message?.type) return;
  Promise.resolve(handleMessage(message, sender))
    .then(result => sendResponse(result))
    .catch(error => sendResponse({ ok: false, error: String(error) }));
  return true;
});

async function handleMessage(message, sender) {
  if (message.type === 'CHATSENTINEL_SIGNAL') return forwardSignal(message, sender.tab);
  if (message.type === 'CHATSENTINEL_API') {
    const result = await apiRequest(message.route, message.method, message.body, watchdogBase(message.pageUrl));
    if (result?.ok && /^\/projects\/(?:upsert|attach|detach|delete)$/.test(message.route || '')) {
      sessionRestoreController.scheduleCaptureAll('project-change');
    }
    return result;
  }
  if (message.type === 'CHATSENTINEL_TAB_CONTEXT') return tabContext(sender.tab);
  if (message.type === 'CHATSENTINEL_FOCUS_TAB') return focusTab(message.tabId, message.url);
  if (message.type === 'CHATSENTINEL_GROUP_PROJECT_TABS') return groupProjectTabs(message.project);
  if (message.type === 'CHATSENTINEL_NEW_PROJECT_CHAT') return newProjectChat(message.project, sender.tab);
  if (message.type === 'CHATSENTINEL_LIST_SESSION_SNAPSHOTS') return { ok: true, snapshots: await sessionRestoreController.listSnapshots(message.projectId) };
  if (message.type === 'CHATSENTINEL_CAPTURE_SESSION_SNAPSHOT') return { ok: true, snapshot: await sessionRestoreController.captureProjectById(message.projectId, message.reason || 'manual') };
  if (message.type === 'CHATSENTINEL_RESTORE_SESSION_SNAPSHOT') return sessionRestoreController.restoreSnapshot(message.snapshotId, { entryIds: message.entryIds, conversationIds: message.conversationIds, activate: message.activate !== false });
  if (message.type === 'CHATSENTINEL_SWITCH_PROJECT') return sessionRestoreController.switchProject(message.projectId);
  return { ok: false, error: 'unknown-message' };
}

async function forwardSignal(signal, tab) {
  const tabId = tab?.id;
  const conversationId = signal.conversationId || (tabId ? `tab:${tabId}` : 'unknown');
  const normalized = {
    ...signal,
    conversationId,
    tabId,
    title: tab?.title,
    url: signal.url || tab?.url
  };

  await attachPendingProject(tabId, normalized);
  await migrateTabIdentity(tabId, conversationId, normalized);

  const response = await apiRequest('/signal', 'POST', {
    ...normalized,
    retryCount: await effectiveRetryCount(normalized)
  }, watchdogBase(normalized.url));

  if (!response.ok) return { ...response, execution: { executed: false, reason: 'watchdog-rejected' } };
  await recordDecision(conversationId, response);
  const execution = await maybeAct(response, tabId, normalized);
  return { ...response, execution };
}

async function maybeAct(result, tabId, payload) {
  if (!result?.decision || !tabId) return { executed: false, reason: 'decision-or-tab-missing' };
  const settings = await chrome.storage.local.get(['autoRecoveryEnabled']);
  const fixtureAuto = isFixtureAuto(payload.url);
  const projectEnabled = Boolean(result.project?.autoRecovery);
  if (!fixtureAuto && !(settings.autoRecoveryEnabled && projectEnabled)) {
    return { executed: false, reason: projectEnabled ? 'global-auto-recovery-disabled' : 'project-auto-recovery-disabled' };
  }

  if (result.decision.action === 'SAFE_RETRY') await incrementRetryCount(payload.conversationId);
  const execution = await chrome.tabs.sendMessage(tabId, {
    type: 'CHATSENTINEL_EXECUTE',
    decision: result.decision,
    context: {
      reconciliation: result.reconciliation,
      projectPath: result.projectPath,
      decision: result.decision,
      newChatUrl: fixtureAuto ? fixtureNewChatUrl(payload.url, payload.conversationId) : undefined
    }
  }).catch(error => ({ ok: false, error: String(error) }));

  await chrome.storage.local.set({
    [`execution:${payload.conversationId}`]: { ...execution, decision: result.decision, tabId, at: new Date().toISOString() }
  });
  return execution;
}

async function attachPendingProject(tabId, signal) {
  if (!tabId) return;
  const key = `pendingProject:${tabId}`;
  const stored = await chrome.storage.local.get(key);
  const projectId = stored[key];
  if (!projectId) return;
  const result = await apiRequest('/projects/attach', 'POST', {
    projectId,
    conversationId: signal.conversationId,
    tabId,
    title: signal.title,
    url: signal.url
  });
  if (result.ok) await chrome.storage.local.remove(key);
}

async function migrateTabIdentity(tabId, conversationId, signal) {
  if (!tabId) return;
  const fallbackId = `tab:${tabId}`;
  if (fallbackId === conversationId) return;
  const markerKey = `stableIdentity:${tabId}`;
  const marker = await chrome.storage.local.get(markerKey);
  if (marker[markerKey] === conversationId) return;

  const fallback = await apiRequest(`/project/context?conversationId=${encodeURIComponent(fallbackId)}`);
  const projectId = fallback?.config?.projectId;
  if (projectId) {
    const current = await apiRequest(`/project/context?conversationId=${encodeURIComponent(conversationId)}`);
    if (!current?.config?.projectId) {
      await apiRequest('/projects/attach', 'POST', {
        projectId,
        conversationId,
        tabId,
        title: signal.title,
        url: signal.url
      });
    }
    await apiRequest('/projects/detach', 'POST', { conversationId: fallbackId, forget: true });
  }
  await chrome.storage.local.set({ [markerKey]: conversationId });
}

async function recordDecision(conversationId, result) {
  await chrome.storage.local.set({
    [`decision:${conversationId}`]: { ...result, at: new Date().toISOString() }
  });
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

async function apiRequest(route, method = 'GET', body, base = DEFAULT_WATCHDOG) {
  const headers = { ...CLIENT_HEADERS };
  const options = { method, headers };
  if (body !== undefined) options.body = JSON.stringify(body);
  const response = await fetch(`${base}${route}`, options);
  const result = await response.json().catch(() => ({ ok: false, error: `http-${response.status}` }));
  return response.ok ? result : { ...result, ok: false, status: response.status };
}

function tabContext(tab) {
  return { ok: true, tabId: tab?.id, windowId: tab?.windowId, title: tab?.title, url: tab?.url };
}

async function focusTab(tabId, fallbackUrl) {
  const id = Number(tabId);
  if (Number.isInteger(id)) {
    try {
      const tab = await chrome.tabs.get(id);
      await chrome.windows.update(tab.windowId, { focused: true });
      await chrome.tabs.update(id, { active: true });
      return { ok: true, tabId: id, reused: true };
    } catch {}
  }
  if (typeof fallbackUrl === 'string' && /^https:\/\/chatgpt\.com\//i.test(fallbackUrl)) {
    const tab = await chrome.tabs.create({ url: fallbackUrl, active: true });
    return { ok: true, tabId: tab.id, reused: false };
  }
  return { ok: false, error: 'chat-tab-unavailable' };
}

// Tab grouping pattern adapted from GoogleChrome/chrome-extensions-samples
// (Apache-2.0): chrome.tabs.group + chrome.tabGroups.update.
async function groupProjectTabs(project) {
  if (!project?.projectId) return { ok: false, error: 'project-required' };
  const live = [];
  for (const chat of project.chats || []) {
    if (!Number.isInteger(Number(chat.tabId))) continue;
    try { live.push(await chrome.tabs.get(Number(chat.tabId))); } catch {}
  }
  if (!live.length) return { ok: true, groups: [] };

  const byWindow = new Map();
  for (const tab of live) {
    const list = byWindow.get(tab.windowId) || [];
    list.push(tab.id);
    byWindow.set(tab.windowId, list);
  }

  const groups = [];
  for (const [windowId, tabIds] of byWindow) {
    const groupId = await chrome.tabs.group({ tabIds, createProperties: { windowId } });
    await chrome.tabGroups.update(groupId, {
      title: project.name || 'ChatSentinel Project',
      color: normalizeGroupColor(project.color)
    });
    groups.push({ windowId, groupId, tabIds });
  }
  return { ok: true, groups };
}

async function newProjectChat(project, sourceTab) {
  if (!project?.projectId) return { ok: false, error: 'project-required' };
  const tab = await chrome.tabs.create({
    url: 'https://chatgpt.com/',
    active: true,
    windowId: sourceTab?.windowId
  });
  await chrome.storage.local.set({ [`pendingProject:${tab.id}`]: project.projectId });
  if (project.groupTabs !== false) {
    const current = { ...project, chats: [...(project.chats || []), { tabId: tab.id }] };
    await groupProjectTabs(current).catch(() => {});
  }
  return { ok: true, tabId: tab.id, windowId: tab.windowId };
}

function normalizeGroupColor(value) {
  const allowed = new Set(['grey', 'blue', 'red', 'yellow', 'green', 'pink', 'purple', 'cyan', 'orange']);
  return allowed.has(value) ? value : 'blue';
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
    return typeof url === 'string' && url.startsWith('http://127.0.0.1:4320/') && new URL(url).searchParams.get('auto') === '1';
  } catch { return false; }
}

function fixtureNewChatUrl(url, conversationId) {
  const fixture = new URL(url);
  const watchdog = fixture.searchParams.get('watchdog');
  const params = new URLSearchParams({ auto: '1', cid: `${conversationId}-new` });
  if (watchdog) params.set('watchdog', watchdog);
  return `http://127.0.0.1:4320/newchat?${params}`;
}

function isChatGptUrl(url) {
  return /^https:\/\/chatgpt\.com\//i.test(url || '');
}
