(() => {
  const ALARM = 'chatsentinel-command-poll';
  const LEASE_MS = 60000;
  const MAX_BATCH = 6;
  let polling = false;

  chrome.alarms.create(ALARM, { periodInMinutes: 0.5 });
  chrome.alarms.onAlarm.addListener(alarm => {
    if (alarm.name === ALARM) kick();
  });
  chrome.runtime.onStartup.addListener(() => kick());
  chrome.runtime.onInstalled.addListener(() => kick());

  async function kick() {
    if (polling) return;
    polling = true;
    try {
      const workerId = await getWorkerId();
      for (let index = 0; index < MAX_BATCH; index += 1) {
        const claimed = await commandApi('/commands/claim', 'POST', { workerId, leaseMs: LEASE_MS });
        const command = claimed?.command;
        if (!command) break;
        await executeClaimed(command, workerId);
      }
    } catch (error) {
      console.warn('ChatSentinel command poll failed', error);
    } finally {
      polling = false;
    }
  }

  async function executeClaimed(command, workerId) {
    try {
      const result = await executeCommand(command, workerId);
      await commandApi('/commands/complete', 'POST', {
        commandId: command.commandId,
        outcome: 'succeeded',
        result
      });
    } catch (error) {
      const retryAfterMs = Math.min(15000, 750 * Math.max(1, Number(command.attempts || 1)));
      await commandApi('/commands/complete', 'POST', {
        commandId: command.commandId,
        outcome: 'retry',
        error: String(error?.message || error),
        retryAfterMs
      }).catch(() => {});
    }
  }

  async function executeCommand(command, workerId) {
    switch (command.type) {
      case 'CREATE_LANE_CHAT':
        return createLaneChat(command, workerId);
      case 'SEND_PROMPT':
        return sendPrompt(command, workerId);
      case 'GROUP_PROJECT_TABS':
        return groupTabs(command);
      case 'FOCUS_CHAT':
        return focusCommand(command);
      case 'RELOAD_CHAT':
        return reloadCommand(command);
      case 'CLOSE_CHAT':
        return closeCommand(command);
      case 'REPLACE_CHAT':
        return replaceCommand(command, workerId);
      default:
        throw new Error(`unsupported-command:${command.type}`);
    }
  }

  async function createLaneChat(command, workerId) {
    const payload = command.payload || {};
    const project = await getProject(payload.projectId);
    if (!project) throw new Error('project-not-found');
    const progress = command.progress || {};
    let tab = progress.tabId ? await safeGetTab(progress.tabId) : null;

    if (!tab) {
      tab = await chrome.tabs.create({
        url: payload.url || 'https://chatgpt.com/',
        active: false
      });
      await progressCommand(command, workerId, { step: 'tab-created', tabId: tab.id, windowId: tab.windowId });
    }

    const fallbackId = `tab:${tab.id}`;
    if (!progress.attached) {
      const attached = await commandApi('/projects/attach', 'POST', {
        projectId: project.projectId,
        conversationId: fallbackId,
        tabId: tab.id,
        title: payload.laneName || payload.laneId || tab.title || 'ChatSentinel lane',
        url: tab.url || payload.url || 'https://chatgpt.com/',
        laneId: payload.laneId,
        laneName: payload.laneName,
        branch: payload.branch,
        role: payload.role
      });
      if (!attached?.ok) throw new Error(attached?.error || 'project-attach-failed');
      await progressCommand(command, workerId, { step: 'attached', tabId: tab.id, attached: true });
    }

    if (project.groupTabs !== false && !progress.grouped) {
      const refreshed = await getProject(project.projectId);
      const grouped = await groupProjectTabs(refreshed);
      if (!grouped?.ok) throw new Error(grouped?.error || 'tab-group-failed');
      await progressCommand(command, workerId, { step: 'grouped', tabId: tab.id, grouped: true });
    }

    await ensureContent(tab.id);
    if (!progress.promptSent) {
      const sent = await chrome.tabs.sendMessage(tab.id, {
        type: 'CHATSENTINEL_SEND_PROMPT',
        commandId: command.commandId,
        prompt: payload.prompt
      }).catch(error => ({ ok: false, error: String(error) }));
      if (!sent?.ok) throw new Error(sent?.error || sent?.reason || 'prompt-send-failed');
      await progressCommand(command, workerId, { step: 'prompt-sent', tabId: tab.id, promptSent: true });
    }

    const identity = await waitForStableIdentity(tab.id, fallbackId);
    if (identity && identity !== fallbackId && identity !== progress.stableConversationId) {
      const stableAttach = await commandApi('/projects/attach', 'POST', {
        projectId: project.projectId,
        conversationId: identity,
        tabId: tab.id,
        title: payload.laneName || payload.laneId,
        url: (await safeGetTab(tab.id))?.url,
        laneId: payload.laneId,
        laneName: payload.laneName,
        branch: payload.branch,
        role: payload.role
      });
      if (stableAttach?.ok) {
        await commandApi('/projects/detach', 'POST', { conversationId: fallbackId, forget: true }).catch(() => {});
        await progressCommand(command, workerId, { step: 'stable-identity', stableConversationId: identity });
      }
    }

    return {
      projectId: project.projectId,
      tabId: tab.id,
      conversationId: identity || fallbackId,
      laneId: payload.laneId,
      branch: payload.branch,
      promptSent: true
    };
  }

  async function sendPrompt(command, workerId) {
    const tab = await resolveTargetTab(command.payload || {});
    if (!tab) throw new Error('target-tab-not-found');
    await ensureContent(tab.id);
    if (!command.progress?.promptSent) {
      const sent = await chrome.tabs.sendMessage(tab.id, {
        type: 'CHATSENTINEL_SEND_PROMPT',
        commandId: command.commandId,
        prompt: command.payload.prompt
      }).catch(error => ({ ok: false, error: String(error) }));
      if (!sent?.ok) throw new Error(sent?.error || sent?.reason || 'prompt-send-failed');
      await progressCommand(command, workerId, { step: 'prompt-sent', tabId: tab.id, promptSent: true });
    }
    return { tabId: tab.id, promptSent: true };
  }

  async function groupTabs(command) {
    const project = await getProject(command.payload?.projectId);
    if (!project) throw new Error('project-not-found');
    const grouped = await groupProjectTabs(project);
    if (!grouped?.ok) throw new Error(grouped?.error || 'tab-group-failed');
    return grouped;
  }

  async function focusCommand(command) {
    const tab = await resolveTargetTab(command.payload || {});
    if (!tab) throw new Error('target-tab-not-found');
    return focusTab(tab.id, tab.url);
  }

  async function reloadCommand(command) {
    const tab = await resolveTargetTab(command.payload || {});
    if (!tab) throw new Error('target-tab-not-found');
    await chrome.tabs.reload(tab.id);
    return { tabId: tab.id, reloaded: true };
  }

  async function closeCommand(command) {
    const tab = await resolveTargetTab(command.payload || {});
    if (!tab) return { closed: false, reason: 'already-closed' };
    await chrome.tabs.remove(tab.id);
    return { tabId: tab.id, closed: true };
  }

  async function replaceCommand(command, workerId) {
    const oldTab = await resolveTargetTab(command.payload || {});
    const result = await createLaneChat(command, workerId);
    if (command.payload?.closeOld && oldTab?.id && oldTab.id !== result.tabId) {
      await chrome.tabs.remove(oldTab.id).catch(() => {});
      return { ...result, replacedTabId: oldTab.id, oldClosed: true };
    }
    return { ...result, replacedTabId: oldTab?.id, oldClosed: false };
  }

  async function progressCommand(command, workerId, progress) {
    const response = await commandApi('/commands/progress', 'POST', {
      commandId: command.commandId,
      workerId,
      leaseMs: LEASE_MS,
      progress
    });
    if (!response?.ok) throw new Error(response?.error || 'command-progress-failed');
    command.progress = { ...(command.progress || {}), ...progress };
    return response.command;
  }

  async function getProject(projectId) {
    const response = await commandApi('/projects');
    if (!response?.ok) throw new Error(response?.error || 'projects-read-failed');
    return (response.projects || []).find(project => project.projectId === projectId) || null;
  }

  async function resolveTargetTab(payload) {
    if (Number.isInteger(Number(payload.tabId))) {
      const tab = await safeGetTab(Number(payload.tabId));
      if (tab) return tab;
    }
    if (payload.conversationId) {
      const context = await commandApi(`/project/context?conversationId=${encodeURIComponent(payload.conversationId)}`);
      const tabId = context?.config?.tabId;
      if (Number.isInteger(Number(tabId))) {
        const tab = await safeGetTab(Number(tabId));
        if (tab) return tab;
      }
    }
    if (payload.url && /^https:\/\/chatgpt\.com\//i.test(payload.url)) {
      const tabs = await chrome.tabs.query({ url: payload.url });
      if (tabs[0]) return tabs[0];
    }
    return null;
  }

  async function ensureContent(tabId) {
    for (let attempt = 0; attempt < 30; attempt += 1) {
      const ready = await chrome.tabs.sendMessage(tabId, { type: 'CHATSENTINEL_GET_IDENTITY' }).catch(() => null);
      if (ready?.ok) return ready;
      if (attempt === 2) {
        await chrome.scripting.executeScript({
          target: { tabId },
          files: ['identity.js', 'actuator.js', 'content.js', 'project-console.js']
        }).catch(() => {});
      }
      await sleep(500);
    }
    throw new Error('content-script-not-ready');
  }

  async function waitForStableIdentity(tabId, fallbackId) {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const ready = await chrome.tabs.sendMessage(tabId, { type: 'CHATSENTINEL_GET_IDENTITY' }).catch(() => null);
      const id = ready?.identity?.id;
      if (id && id !== fallbackId && !id.startsWith('page:')) return id;
      await sleep(500);
    }
    return fallbackId;
  }


  async function commandApi(route, method = 'GET', body) {
    return apiRequest(route, method, body, await commandBase());
  }

  async function commandBase() {
    const stored = await chrome.storage.local.get('commandWatchdogBase');
    const value = stored.commandWatchdogBase;
    return typeof value === 'string' && /^http:\/\/127\.0\.0\.1:\d{4,5}$/.test(value)
      ? value
      : 'http://127.0.0.1:4317';
  }

  async function safeGetTab(tabId) {
    try { return await chrome.tabs.get(Number(tabId)); }
    catch { return null; }
  }

  async function getWorkerId() {
    const key = 'commandWorkerId';
    const stored = await chrome.storage.local.get(key);
    if (stored[key]) return stored[key];
    const value = `extension:${cryptoRandomId()}`;
    await chrome.storage.local.set({ [key]: value });
    return value;
  }

  function cryptoRandomId() {
    const values = new Uint32Array(4);
    crypto.getRandomValues(values);
    return [...values].map(value => value.toString(16).padStart(8, '0')).join('');
  }

  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  globalThis.ChatSentinelCommandManager = { kick };
  kick();
})();
