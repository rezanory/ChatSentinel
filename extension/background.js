importScripts('components/project-chat-lifecycle/controller.js', 'session-snapshot-store.js', 'session-restore-controller.js');

const DEFAULT_WATCHDOG = 'http://127.0.0.1:4317';
const CLIENT_HEADERS = Object.freeze({
  'content-type': 'application/json',
  'x-chatsentinel-client': 'extension'
});
const sessionSnapshotStore = new ChatSentinelSessionSnapshots.SessionSnapshotStore({ storage: chrome.storage.local });
const sessionRestoreController = new ChatSentinelSessionRestore.SessionRestoreController({
  chromeApi: chrome, snapshotStore: sessionSnapshotStore, apiRequest,
  onError: error => console.warn('ChatSentinel session restore:', error)
});
globalThis.sessionSnapshotStore = sessionSnapshotStore;
globalThis.sessionRestoreController = sessionRestoreController;

importScripts('components/tab-launch-guard/controller.js', 'command-executor.js');

const crashRecoveryInFlight = new Set();
const crashRecoveryPending = new Map();

chrome.action.onClicked.addListener(tab => togglePanelInTab(tab));
chrome.tabs.onRemoved.addListener((tabId, removeInfo) => {
  const guard = globalThis.ChatSentinelTabLaunchGuard;
  chrome.storage.local.remove([`pendingProject:${tabId}`, guard?.crashRecoveryKey?.(tabId)]).catch(() => {});
  if (!removeInfo?.isWindowClosing) detachRemovedProjectMemberships(tabId).catch(() => {});
  sessionRestoreController.scheduleCaptureAll(removeInfo?.isWindowClosing ? 'window-closing' : 'tab-removed');
});
chrome.runtime.onStartup.addListener(() => sessionRestoreController.restoreAfterBrowserRestart()
  .then(() => sessionRestoreController.captureAllProjects('post-startup').catch(() => {}))
  .catch(error => console.warn('ChatSentinel startup restore:', error)));
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.url || changeInfo.title || changeInfo.pinned !== undefined || changeInfo.groupId !== undefined) sessionRestoreController.scheduleCaptureAll('tab-updated');
  const guard = globalThis.ChatSentinelTabLaunchGuard; if (!guard) return;
  const titleFailure = typeof changeInfo.title === 'string' ? guard.classifyTab({ ...tab, title: changeInfo.title }) : null;
  const urlFailure = typeof changeInfo.url === 'string' ? guard.classifyTab({ ...tab, url: changeInfo.url, title: '' }) : null;
  const failure = titleFailure?.crashed ? titleFailure : (urlFailure?.crashed ? urlFailure : null); if (!failure) return;
  const observed = { ...tab, url: changeInfo.url || tab?.url, title: changeInfo.title || tab?.title };
  recoverCrashedProjectTab(tabId, observed, failure).catch(error => console.warn('ChatSentinel crashed-tab recovery failed', error));
});
chrome.tabs.onMoved.addListener(() => sessionRestoreController.scheduleCaptureAll('tab-moved'));
chrome.tabs.onAttached.addListener(() => sessionRestoreController.scheduleCaptureAll('tab-attached'));
chrome.tabs.onDetached.addListener(() => sessionRestoreController.scheduleCaptureAll('tab-detached'));
chrome.tabGroups.onCreated.addListener(() => sessionRestoreController.scheduleCaptureAll('group-created'));
chrome.tabGroups.onUpdated.addListener(() => sessionRestoreController.scheduleCaptureAll('group-updated'));
chrome.tabGroups.onMoved.addListener(() => sessionRestoreController.scheduleCaptureAll('group-moved'));

async function detachRemovedProjectMemberships(tabId) {
  const projects = await apiRequest('/projects').catch(() => null);
  const lifecycle = globalThis.ChatSentinelProjectChatLifecycle;
  const rows = lifecycle?.membershipsForClosedTab?.(projects?.projects || [], tabId) || [];
  for (const row of rows) {
    const forget = row.conversationId === `tab:${tabId}`;
    await apiRequest('/projects/detach', 'POST', { conversationId: row.conversationId, forget }).catch(() => {});
  }
  return rows.length;
}

async function recoverCrashedProjectTab(tabId, observedTab, failure) {
  if (crashRecoveryInFlight.has(tabId)) {
    crashRecoveryPending.set(tabId, { observedTab, failure, queuedAt: Date.now() });
    return { ok: false, queued: true, reason: 'crash-recovery-in-flight' };
  }
  crashRecoveryInFlight.add(tabId);
  try {
    const context = await findProjectChatByTab(tabId);
    if (!context?.project || !context?.chat) return { ok: false, reason: 'crashed-tab-not-project-owned' };
    if (!context.project.autoRecovery) return { ok: false, reason: 'project-auto-recovery-disabled' };

    const guard = globalThis.ChatSentinelTabLaunchGuard;
    const key = guard.crashRecoveryKey(tabId);
    const stored = await chrome.storage.local.get(key);
    const previous = stored?.[key] || {};
    const next = guard.nextCrashRecoveryAction(previous);
    if (next.action === 'halt') {
      await chrome.storage.local.set({ [key]: { ...previous, status: 'halted', failure, updatedAt: Date.now() } });
      return { ok: false, reason: 'crash-recovery-budget-exhausted' };
    }

    const recovery = {
      ...previous,
      attempts: next.attempts + 1,
      action: next.action,
      status: 'running',
      failure,
      conversationId: context.chat.conversationId,
      projectId: context.project.projectId,
      safeUrl: guard.safeExistingChatUrl(context.chat.url || observedTab?.url),
      updatedAt: Date.now()
    };
    await chrome.storage.local.set({ [key]: recovery });

    if (next.action === 'reload-and-continue') {
      const reloaded = await reloadCrashedTab(tabId, context, recovery);
      if (reloaded.ok) return reloaded;
      return replaceCrashedTab(tabId, context, { ...recovery, attempts: 2, action: 'replace-and-continue' });
    }
    return replaceCrashedTab(tabId, context, recovery);
  } finally {
    crashRecoveryInFlight.delete(tabId);
    if (crashRecoveryPending.has(tabId)) {
      setTimeout(() => drainPendingCrashRecovery(tabId).catch(error =>
        console.warn('ChatSentinel pending crash recovery failed', error)), 250);
    }
  }
}

async function drainPendingCrashRecovery(tabId) {
  const pending = crashRecoveryPending.get(tabId);
  if (!pending || crashRecoveryInFlight.has(tabId)) return false;
  crashRecoveryPending.delete(tabId);
  const current = await chrome.tabs.get(tabId).catch(() => null);
  if (!current) return false;
  const guard = globalThis.ChatSentinelTabLaunchGuard;
  const currentFailure = guard.classifyTab(current);
  if (!currentFailure.crashed) return false;
  await recoverCrashedProjectTab(tabId, current, currentFailure);
  return true;
}

async function reloadCrashedTab(tabId, context, recovery) {
  const guard = globalThis.ChatSentinelTabLaunchGuard;
  await guard.acquireLaunchSlot(chrome.storage.local, sleep);
  await chrome.tabs.update(tabId, { url: recovery.safeUrl }).catch(() => null);
  const ready = await waitForRecoveryContent(tabId, 15000, recovery.safeUrl);
  if (!ready) return { ok: false, reason: 'crash-reload-content-not-ready' };
  const sent = await sendCrashContinuation(tabId, context, recovery);
  if (!sent.ok) return sent;
  await chrome.storage.local.set({
    [guard.crashRecoveryKey(tabId)]: { ...recovery, status: 'continued-after-reload', continuationSent: true, updatedAt: Date.now() }
  });
  return { ok: true, action: 'reload-and-continue', tabId };
}

async function replaceCrashedTab(oldTabId, context, recovery) {
  const guard = globalThis.ChatSentinelTabLaunchGuard;
  await guard.acquireLaunchSlot(chrome.storage.local, sleep);
  const oldTab = await chrome.tabs.get(oldTabId).catch(() => null);
  const newTab = await chrome.tabs.create({
    url: recovery.safeUrl,
    active: false,
    ...(oldTab?.windowId ? { windowId: oldTab.windowId } : {})
  });
  await chrome.storage.local.set({
    [guard.crashRecoveryKey(newTab.id)]: { ...recovery, attempts: 2, status: 'replacement-created', parentTabId: oldTabId, updatedAt: Date.now() }
  });

  const ready = await waitForRecoveryContent(newTab.id, 20000, recovery.safeUrl);
  if (!ready) {
    await chrome.tabs.remove(newTab.id).catch(() => {});
    return { ok: false, reason: 'crash-replacement-content-not-ready' };
  }
  const replacementConversationId = String(context.chat.conversationId || '').startsWith('tab:')
    ? `tab:${newTab.id}`
    : context.chat.conversationId;
  const attach = await apiRequest('/projects/attach', 'POST', {
    projectId: context.project.projectId,
    conversationId: replacementConversationId,
    tabId: newTab.id,
    title: context.chat.title,
    url: recovery.safeUrl,
    laneId: context.chat.laneId,
    laneName: context.chat.laneName,
    branch: context.chat.branch,
    role: context.chat.role
  }).catch(() => null);
  if (!attach?.ok) {
    await chrome.tabs.remove(newTab.id).catch(() => {});
    return { ok: false, reason: 'crash-replacement-attach-failed' };
  }

  const replacementContext = { ...context, chat: { ...context.chat, conversationId: replacementConversationId, tabId: newTab.id } };
  const sent = await sendCrashContinuation(newTab.id, replacementContext, recovery);
  if (!sent.ok) {
    await chrome.storage.local.set({
      [guard.crashRecoveryKey(newTab.id)]: { ...recovery, attempts: 2, status: 'replacement-continuation-pending', updatedAt: Date.now() }
    });
  } else {
    await chrome.storage.local.set({
      [guard.crashRecoveryKey(newTab.id)]: { ...recovery, attempts: 2, status: 'continued-after-replace', continuationSent: true, updatedAt: Date.now() }
    });
  }

  const refreshed = await apiRequest('/projects').catch(() => null);
  const project = refreshed?.projects?.find(row => row.projectId === context.project.projectId);
  if (project?.groupTabs !== false) await groupProjectTabs(project).catch(() => {});
  await chrome.tabs.remove(oldTabId).catch(() => {});
  return { ok: true, action: 'replace-and-continue', oldTabId, tabId: newTab.id, continuationSent: Boolean(sent.ok) };
}

async function sendCrashContinuation(tabId, context, recovery) {
  const guard = globalThis.ChatSentinelTabLaunchGuard;
  const prompt = guard.buildCrashContinuationPrompt({ branch: context.chat.branch });
  const commandId = `crash-recovery:${context.chat.conversationId}:${String(recovery.updatedAt || Date.now())}`;
  let last = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    last = await chrome.tabs.sendMessage(tabId, {
      type: 'CHATSENTINEL_SEND_PROMPT',
      commandId,
      prompt
    }).catch(error => ({ ok: false, error: String(error) }));
    if (last?.ok) return last;
    await sleep(2000);
  }
  return last || { ok: false, reason: 'crash-continuation-send-failed' };
}

async function waitForRecoveryContent(tabId, timeoutMs, expectedUrl) {
  const deadline = Date.now() + Math.max(1000, Number(timeoutMs || 15000));
  while (Date.now() < deadline) {
    const tab = await chrome.tabs.get(tabId).catch(() => null);
    if (tab && sameRecoveryLocation(tab.url, expectedUrl)) {
      const reply = await chrome.tabs.sendMessage(tabId, { type: 'CHATSENTINEL_GET_IDENTITY' }).catch(() => null);
      if (reply?.ok) {
        await sleep(750);
        const confirmed = await chrome.tabs.get(tabId).catch(() => null);
        if (confirmed && sameRecoveryLocation(confirmed.url, expectedUrl)) return true;
      }
    }
    await sleep(500);
  }
  return false;
}

function sameRecoveryLocation(actual, expected) {
  try {
    const a = new URL(String(actual || ''));
    const e = new URL(String(expected || ''));
    return a.origin === e.origin && a.pathname === e.pathname;
  } catch {
    return false;
  }
}

async function findProjectChatByTab(tabId) {
  const response = await apiRequest('/projects').catch(() => null);
  for (const project of response?.projects || []) {
    const chat = (project.chats || []).find(row => Number(row.tabId) === Number(tabId));
    if (chat) return { project, chat };
  }
  return null;
}

async function togglePanelInTab(tab) {
  if (!tab?.id || !isChatGptUrl(tab.url)) return { ok: false, error: 'chatgpt-tab-required' };
  let response = await chrome.tabs.sendMessage(tab.id, { type: 'CHATSENTINEL_TOGGLE_PANEL' }).catch(() => null);
  if (response?.ok) return response;
  await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    files: ['components/runtime-context-guard/controller.js', 'components/tab-launch-guard/controller.js', 'components/message-delivery-recovery/controller.js', 'components/response-completion-recovery/controller.js', 'identity.js', 'actuator.js', 'content.js', 'components/project-chat-lifecycle/controller.js', 'components/full-project-mode/controller.js', 'project-console.js']
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
    if (result?.ok && /^(?:\/projects\/(?:upsert|attach|detach|delete)|\/full-project-mode\/activate)$/.test(message.route || '')) sessionRestoreController.scheduleCaptureAll('project-change');
    return result;
  }
  if (message.type === 'CHATSENTINEL_TAB_CONTEXT') return tabContext(sender.tab);
  if (message.type === 'CHATSENTINEL_LIVE_TAB_IDS') return liveTabIds(message.tabIds);
  if (message.type === 'CHATSENTINEL_FOCUS_TAB') return focusTab(message.tabId, message.url);
  if (message.type === 'CHATSENTINEL_GROUP_PROJECT_TABS') return groupProjectTabs(message.project);
  if (message.type === 'CHATSENTINEL_NEW_PROJECT_CHAT') return newProjectChat(message.project, sender.tab);
  if (message.type === 'CHATSENTINEL_LIST_SESSION_SNAPSHOTS') return { ok: true, snapshots: await sessionRestoreController.listSnapshots(message.projectId) };
  if (message.type === 'CHATSENTINEL_CAPTURE_SESSION_SNAPSHOT') return { ok: true, snapshot: await sessionRestoreController.captureProjectById(message.projectId, message.reason || 'manual') };
  if (message.type === 'CHATSENTINEL_RESTORE_SESSION_SNAPSHOT') return sessionRestoreController.restoreSnapshot(message.snapshotId, { entryIds: message.entryIds, conversationIds: message.conversationIds, activate: message.activate !== false });
  if (message.type === 'CHATSENTINEL_SWITCH_PROJECT') return sessionRestoreController.switchProject(message.projectId);
  return { ok: false, error: 'unknown-message' };
}

async function liveTabIds(tabIds = []) {
  const ids = [...new Set((tabIds || []).map(Number).filter(Number.isInteger))];
  const rows = await Promise.all(ids.map(async tabId => {
    const tab = await chrome.tabs.get(tabId).catch(() => null);
    if (!tab) return null;
    const active = await probeTabActivity(tabId);
    return { tabId, active };
  }));
  const live = rows.filter(Boolean);
  return {
    ok: true,
    tabIds: live.map(row => row.tabId),
    activeTabIds: live.filter(row => row.active).map(row => row.tabId)
  };
}

async function probeTabActivity(tabId) {
  const result = await chrome.scripting.executeScript({
    target: { tabId },
    func: () => {
      const labels = [...document.querySelectorAll('button')]
        .map(button => `${button.getAttribute('aria-label') || ''} ${button.textContent || ''}`.trim().toLowerCase());
      return labels.some(value => /stop generating|continue generating|retry/.test(value));
    }
  }).catch(() => null);
  return result?.[0]?.result === true;
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
  globalThis.ChatSentinelCommandManager?.kick?.();
  return { ...response, execution };
}

async function maybeAct(result, tabId, payload) {
  if (!result?.decision || !tabId) return { executed: false, reason: 'decision-or-tab-missing' };
  const fixtureAuto = isFixtureAuto(payload.url);
  const projectEnabled = Boolean(result.project?.autoRecovery);
  if (!fixtureAuto && !projectEnabled) {
    return { executed: false, reason: 'project-auto-recovery-disabled' };
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
        title: signal.title || fallback.config.title,
        url: signal.url || fallback.config.url,
        laneId: fallback.config.laneId,
        laneName: fallback.config.laneName,
        branch: fallback.config.branch,
        role: fallback.config.role
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
    const tab = await createPacedTab({ url: fallbackUrl, active: true, newChat: false });
    return { ok: true, tabId: tab.id, reused: false };
  }
  return { ok: false, error: 'chat-tab-unavailable' };
}

async function createPacedTab({ url, active = false, windowId, newChat = false } = {}) {
  const guard = globalThis.ChatSentinelTabLaunchGuard;
  if (!guard) throw new Error('tab-launch-guard-unavailable');
  const safeUrl = newChat ? guard.safeNewChatUrl(url) : guard.safeExistingChatUrl(url);
  await guard.acquireLaunchSlot(chrome.storage.local, sleep);
  const tab = await chrome.tabs.create({
    url: safeUrl,
    active,
    ...(Number.isInteger(Number(windowId)) ? { windowId: Number(windowId) } : {})
  });
  await sleep(guard.DEFAULT_PAGE_SETTLE_MS);
  const current = await chrome.tabs.get(tab.id).catch(() => tab);
  const state = guard.classifyTab(current);
  if (!state.healthy) {
    await chrome.tabs.remove(tab.id).catch(() => {});
    throw new Error(state.reason || 'tab-launch-failed');
  }
  return current;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
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
  const tab = await createPacedTab({
    url: 'https://chatgpt.com/',
    active: true,
    windowId: sourceTab?.windowId,
    newChat: true
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
