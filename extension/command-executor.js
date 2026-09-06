importScripts('components/chat-control/controller.js', 'components/chat-control/membership-repair.js');
(() => {
  const ALARM = 'chatsentinel-command-poll';
  const LEASE_MS = 60000;
  const MAX_BATCH = 6;
  const RATE_SENSITIVE_TYPES = Object.freeze(['CREATE_LANE_CHAT', 'SEND_PROMPT', 'RELOAD_CHAT', 'REPLACE_CHAT']);
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
      const requestRate = globalThis.ChatSentinelRequestRateLimit;
      const initialGate = await requestRate?.gate?.(chrome.storage.local) || { allowed: true, level: 0 };
      const batchLimit = initialGate.allowed
        ? (requestRate?.batchLimit?.(initialGate.level, MAX_BATCH) || MAX_BATCH)
        : MAX_BATCH;
      for (let index = 0; index < batchLimit; index += 1) {
        const gate = await requestRate?.gate?.(chrome.storage.local) || { allowed: true };
        const claimBody = { workerId, leaseMs: LEASE_MS };
        if (!gate.allowed) claimBody.excludeTypes = RATE_SENSITIVE_TYPES;
        const claimed = await commandApi('/commands/claim', 'POST', claimBody);
        const command = claimed?.command;
        if (!command) break;
        const rateSensitive = isRateSensitiveCommand(command.type);
        await executeClaimed(command, workerId);
        if (rateSensitive) await requestRate?.markRequest?.(chrome.storage.local);
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
      const requestedDelay = Number(error?.retryAfterMs);
      const retryAfterMs = Number.isFinite(requestedDelay)
        ? Math.max(250, Math.min(60000, requestedDelay))
        : Math.min(15000, 750 * Math.max(1, Number(command.attempts || 1)));
      await commandApi('/commands/complete', 'POST', {
        commandId: command.commandId,
        outcome: error?.terminal === true ? 'failed' : 'retry',
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
      case 'RELOAD_CHAT':
      case 'CLOSE_CHAT':
      case 'REPLACE_CHAT':
        return chatControlCommand(command, workerId);
      default:
        throw new Error(`unsupported-command:${command.type}`);
    }
  }

  async function createLaneChat(command, workerId, options = {}) {
    const guard = globalThis.ChatSentinelTabLaunchGuard;
    if (!guard) throw new Error('tab-launch-guard-unavailable');
    const payload = command.payload || {};
    const project = await getProject(payload.projectId);
    if (!project) throw new Error('project-not-found');
    const progress = command.progress || {};
    let tab = progress.tabId ? await safeGetTab(progress.tabId) : null;
    if (tab?.discarded) tab = await reviveDiscardedTab(tab);

    if (tab && progress.launchFailureReason === 'chatgpt-rate-limited') {
      await chrome.tabs.reload(tab.id).catch(() => {});
      await sleep(guard.DEFAULT_PAGE_SETTLE_MS);
    }

    if (!tab) {
      const safeUrl = guard.safeNewChatUrl(payload.url);
      const slot = await guard.acquireLaunchSlot(chrome.storage.local, sleep);
      tab = await chrome.tabs.create({ url: safeUrl, active: false });
      await progressCommand(command, workerId, {
        step: 'tab-created',
        tabId: tab.id,
        windowId: tab.windowId,
        launchAt: slot.launchAt,
        launchWaitMs: slot.waitMs,
        launchUrl: safeUrl,
        launchUrlSanitized: guard.containsPromptInUrl(payload.url) || Boolean(payload.url && payload.url !== safeUrl)
      });
      await sleep(guard.DEFAULT_PAGE_SETTLE_MS);
    }

    let currentTab = await safeGetTab(tab.id);
    const metadata = guard.classifyTab(currentTab || tab);
    if (!metadata.healthy) {
      await handleLaunchFailure(command, workerId, tab, metadata);
    }

    try {
      await ensureContent(tab.id);
    } catch (error) {
      currentTab = await safeGetTab(tab.id);
      const afterFailure = guard.classifyTab(currentTab || tab);
      if (!afterFailure.healthy) await handleLaunchFailure(command, workerId, tab, afterFailure);
      const retry = retryableError('content-script-not-ready', guard.retryDelay('content-script-not-ready', command.attempts));
      retry.cause = error;
      throw retry;
    }

    const launchState = await chrome.tabs.sendMessage(tab.id, { type: 'CHATSENTINEL_GET_LAUNCH_STATE' })
      .catch(() => null);
    if (launchState?.rateLimited) {
      await handleRateLimitedLaunch(command, workerId, tab, launchState);
    }
    if (launchState?.crashed) {
      await handleLaunchFailure(command, workerId, tab, launchState);
    }
    if (launchState?.workSelected) {
      await handleLaunchFailure(command, workerId, tab, { reason: 'work-mode-selected' });
    }
    if (command.progress?.launchFailureReason) {
      await progressCommand(command, workerId, { step: 'launch-healthy', launchFailureReason: null });
    }
    await enforceRequestRateGate();

    const fallbackId = `tab:${tab.id}`;
    if (!command.progress?.attached) {
      const attached = await commandApi('/projects/attach', 'POST', {
        projectId: project.projectId,
        conversationId: fallbackId,
        tabId: tab.id,
        title: payload.laneName || payload.laneId || tab.title || 'ChatSentinel lane',
        url: (await safeGetTab(tab.id))?.url || guard.safeNewChatUrl(),
        laneId: payload.laneId,
        laneName: payload.laneName,
        branch: payload.branch,
        baselineSha: payload.baselineSha,
        worktreePath: payload.worktreePath,
        role: payload.role
      });
      if (!attached?.ok) throw new Error(attached?.error || 'project-attach-failed');
      await progressCommand(command, workerId, { step: 'attached', tabId: tab.id, attached: true });
    }

    if (project.groupTabs !== false && !command.progress?.grouped) {
      const refreshed = await getProject(project.projectId);
      const grouped = await groupProjectTabs(refreshed);
      if (!grouped?.ok) throw new Error(grouped?.error || 'tab-group-failed');
      await progressCommand(command, workerId, { step: 'grouped', tabId: tab.id, grouped: true });
    }

    const preSendState = await chrome.tabs.sendMessage(tab.id, { type: 'CHATSENTINEL_GET_LAUNCH_STATE' })
      .catch(() => null);
    if (preSendState?.rateLimited) await handleRateLimitedLaunch(command, workerId, tab, preSendState);
    if (preSendState?.crashed) await handleLaunchFailure(command, workerId, tab, preSendState);
    if (preSendState?.workSelected) throw retryableError('work-mode-not-corrected', 1500);

    if (!command.progress?.promptSent) {
      const delivery = await sendPromptWithVerification(
        command, workerId, tab, payload,
        { replaceFromTabId: options.replaceFromTabId }
      );
      if (delivery.deduplicated) {
        await commandApi('/projects/detach', 'POST', { conversationId: `tab:${tab.id}`, forget: true }).catch(() => {});
        if (Number(delivery.ownerTabId) !== Number(tab.id)) await chrome.tabs.remove(tab.id).catch(() => {});
        return {
          projectId: project.projectId,
          tabId: delivery.ownerTabId,
          laneId: payload.laneId,
          branch: payload.branch,
          baselineSha: payload.baselineSha,
          promptSent: Boolean(delivery.promptSent),
          deliveryConfirmed: Boolean(delivery.deliveryConfirmed),
          deduplicated: true,
          reason: delivery.reason,
          ownerTabId: delivery.ownerTabId
        };
      }
    }

    const identity = await waitForStableIdentity(tab.id, fallbackId);
    if (identity && identity !== fallbackId && identity !== command.progress?.stableConversationId) {
      const stableAttach = await commandApi('/projects/attach', 'POST', {
        projectId: project.projectId,
        conversationId: identity,
        tabId: tab.id,
        title: payload.laneName || payload.laneId,
        url: (await safeGetTab(tab.id))?.url,
        laneId: payload.laneId,
        laneName: payload.laneName,
        branch: payload.branch,
        baselineSha: payload.baselineSha,
        worktreePath: payload.worktreePath,
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
      baselineSha: payload.baselineSha,
      promptSent: true,
      deliveryConfirmed: Boolean(command.progress?.deliveryConfirmed),
      deliveryEvidence: command.progress?.deliveryEvidence,
      launchUrl: command.progress?.launchUrl,
      launchUrlSanitized: Boolean(command.progress?.launchUrlSanitized)
    };
  }

  async function sendPrompt(command, workerId) {
    const guard = globalThis.ChatSentinelTabLaunchGuard;
    if (!guard) throw new Error('tab-launch-guard-unavailable');
    const payload = command.payload || {};
    let tab = await resolveTargetTab(payload);
    if (!tab) throw new Error('target-tab-not-found');
    if (tab.discarded) tab = await reviveDiscardedTab(tab);
    await ensureContent(tab.id);
    const preSendState = await chrome.tabs.sendMessage(tab.id, { type: 'CHATSENTINEL_GET_LAUNCH_STATE' }).catch(() => null);
    if (preSendState?.rateLimited) await handleRateLimitedLaunch(command, workerId, tab, preSendState);
    if (preSendState?.crashed) await handleLaunchFailure(command, workerId, tab, preSendState);
    if (preSendState?.workSelected) throw retryableError('work-mode-not-corrected', 1500);
    await enforceRequestRateGate();
    if (!command.progress?.promptSent) {
      const delivery = await sendPromptWithVerification(command, workerId, tab, payload);
      if (delivery.deduplicated) {
        return {
          tabId: delivery.ownerTabId,
          promptSent: false,
          deliveryConfirmed: Boolean(delivery.deliveryConfirmed),
          deduplicated: true,
          reason: delivery.reason
        };
      }
    }
    return { tabId: tab.id, promptSent: true, deliveryConfirmed: true };
  }

  async function sendPromptWithVerification(command, workerId, tab, payload, ownershipOptions = {}) {
    const guard = globalThis.ChatSentinelTabLaunchGuard;
    let existing = await promptDeliveryState(tab.id, payload.prompt);
    if (existing?.contaminatedUrl) {
      await sanitizePromptContamination(tab.id, existing.url);
      await ensureContent(tab.id);
      existing = await promptDeliveryState(tab.id, payload.prompt);
    }
    if (existing?.userTurnMatched && !existing?.contaminatedUrl) {
      await chrome.tabs.sendMessage(tab.id, {
        type: 'CHATSENTINEL_PROMPT_DELIVERY_CONFIRMED', commandId: command.commandId
      }).catch(() => {});
      await progressCommand(command, workerId, {
        step: 'prompt-confirmed', tabId: tab.id, promptSent: true, deliveryConfirmed: true,
        deliveryEvidence: 'existing-user-turn'
      });
      return { promptSent: true, deliveryConfirmed: true, evidence: existing };
    }

    const ownership = await guard.claimPromptOwnership(
      chrome.storage.local, payload, tab.id, safeGetTab,
      { commandId: command.commandId, ...ownershipOptions }
    );
    if (!ownership.allowed) {
      const ownerTabId = Number(ownership.owner?.tabId);
      const ownerTab = Number.isInteger(ownerTabId) ? await safeGetTab(ownerTabId) : null;
      let ownerEvidence = ownerTab ? await promptDeliveryState(ownerTabId, payload.prompt) : null;
      if (ownerEvidence?.contaminatedUrl && ownerTab) {
        await sanitizePromptContamination(ownerTabId, ownerEvidence.url);
        await ensureContent(ownerTabId);
        ownerEvidence = await promptDeliveryState(ownerTabId, payload.prompt);
      }
      if (ownerEvidence?.userTurnMatched && !ownerEvidence?.contaminatedUrl) {
        return {
          promptSent: true, deliveryConfirmed: true, deduplicated: true,
          reason: 'prompt-owned-by-confirmed-live-tab', ownerTabId, evidence: ownerEvidence
        };
      }
      if (ownerTab) {
        const recovered = await sendPromptWithVerification(command, workerId, ownerTab, payload, ownershipOptions);
        return {
          ...recovered,
          deduplicated: true,
          ownerTabId,
          reason: 'recovered-unconfirmed-live-owner'
        };
      }
      throw retryableError('prompt-owner-unavailable', 1500);
    }

    const beforeUrl = (await safeGetTab(tab.id))?.url || '';
    const sent = await chrome.tabs.sendMessage(tab.id, {
      type: 'CHATSENTINEL_SEND_PROMPT',
      commandId: command.commandId,
      prompt: payload.prompt
    }).catch(error => ({ ok: false, error: String(error) }));
    if (!sent?.ok) {
      await guard.releasePromptOwnership(chrome.storage.local, ownership, tab.id, safeGetTab).catch(() => {});
      throw retryableError(sent?.error || sent?.reason || 'prompt-send-failed', 1500);
    }

    const verification = await waitForPromptDelivery(tab.id, payload.prompt, beforeUrl);
    if (!verification.confirmed) {
      await guard.releasePromptOwnership(chrome.storage.local, ownership, tab.id, safeGetTab).catch(() => {});
      await progressCommand(command, workerId, {
        step: 'prompt-delivery-unconfirmed', tabId: tab.id, promptSent: false, deliveryConfirmed: false,
        promptDeliveryReason: verification.reason, promptDeliveryUrl: verification.url
      });
      if (verification.contaminatedUrl) await sanitizePromptContamination(tab.id, verification.url);
      throw retryableError(`prompt-delivery-unconfirmed:${verification.reason || 'unknown'}`, 1500);
    }

    await guard.markPromptDelivered(chrome.storage.local, ownership, tab.id).catch(() => {});
    await chrome.tabs.sendMessage(tab.id, {
      type: 'CHATSENTINEL_PROMPT_DELIVERY_CONFIRMED', commandId: command.commandId
    }).catch(() => {});
    const evidence = verification.userTurnMatched ? 'user-turn' : 'stable-conversation-url';
    await progressCommand(command, workerId, {
      step: 'prompt-confirmed', tabId: tab.id, promptSent: true, deliveryConfirmed: true, deliveryEvidence: evidence
    });
    return { promptSent: true, deliveryConfirmed: true, evidence: verification };
  }

  async function promptDeliveryState(tabId, prompt) {
    return chrome.tabs.sendMessage(tabId, {
      type: 'CHATSENTINEL_PROMPT_DELIVERY_STATE', prompt
    }).catch(() => null);
  }

  async function waitForPromptDelivery(tabId, prompt, beforeUrl, timeoutMs = 12000) {
    const guard = globalThis.ChatSentinelTabLaunchGuard;
    const deadline = Date.now() + timeoutMs;
    let last = { confirmed: false, reason: 'delivery-evidence-timeout', url: beforeUrl };
    const beforeStable = isStableConversationUrl(beforeUrl);
    while (Date.now() < deadline) {
      const tab = await safeGetTab(tabId);
      if (!tab) return { confirmed: false, reason: 'tab-gone', url: '' };
      const url = String(tab.url || '');
      if (guard?.containsPromptInUrl?.(url)) {
        return { confirmed: false, contaminatedUrl: true, reason: 'prompt-url-contaminated', url };
      }
      const state = await promptDeliveryState(tabId, prompt);
      if (state?.userTurnMatched && !state?.contaminatedUrl) {
        return { ...state, confirmed: true, reason: 'user-turn-confirmed', url };
      }
      if (!beforeStable && isStableConversationUrl(url)) {
        return { ...(state || {}), confirmed: true, reason: 'stable-conversation-url', url };
      }
      last = { ...(state || {}), confirmed: false, reason: state?.reason || 'delivery-evidence-timeout', url };
      await sleep(250);
    }
    return last;
  }

  function isStableConversationUrl(value) {
    return /^https:\/\/chatgpt\.com\/c\/[^/?#]+/i.test(String(value || ''));
  }

  async function sanitizePromptContamination(tabId, url) {
    const guard = globalThis.ChatSentinelTabLaunchGuard;
    const safeUrl = guard?.safeNewChatUrl?.(url) || 'https://chatgpt.com/';
    await chrome.tabs.update(tabId, { url: safeUrl }).catch(() => {});
    await sleep(1000);
  }

  async function groupTabs(command) {
    const project = await getProject(command.payload?.projectId);
    if (!project) throw new Error('project-not-found');
    const grouped = await groupProjectTabs(project);
    if (!grouped?.ok) throw new Error(grouped?.error || 'tab-group-failed');
    return grouped;
  }

  async function chatControlCommand(command, workerId) {
    const control = globalThis.ChatSentinelChatControl;
    if (!control?.execute) throw new Error('chat-control-component-unavailable');
    const adapter = {
      resolveTarget: payload => resolveTargetTab(payload),
      focusTab: (tabId, url) => focusTab(tabId, url),
      reloadTab: tabId => chrome.tabs.reload(tabId),
      closeTab: tabId => chrome.tabs.remove(tabId),
      createReplacement: async replacement => {
        const oldTab = await resolveTargetTab(command.payload || {});
        return createLaneChat(replacement, workerId, { replaceFromTabId: oldTab?.id });
      },
      replaceStale: payload => createLaneChat({ ...command, payload }, workerId),
      progress: progress => progressCommand(command, workerId, progress)
    };
    const result = await control.execute(command, adapter, command.payload?.policy);
    if (command.type === 'FOCUS_CHAT' && result?.staleRecovered && result?.tabId) {
      const repair = globalThis.ChatSentinelChatMembershipRepair;
      if (!repair?.repairStaleFocus) throw new Error('chat-membership-repair-unavailable');
      return repair.repairStaleFocus({ command, result }, {
        getProject,
        getTab: safeGetTab,
        attach: payload => commandApi('/projects/attach', 'POST', payload),
        groupProjectTabs
      });
    }
    return result;
  }

  async function handleLaunchFailure(command, workerId, tab, detail = {}) {
    const guard = globalThis.ChatSentinelTabLaunchGuard;
    const count = Number(command.progress?.replacementCount || 0);
    if (!guard.replacementAllowed(count)) {
      await chrome.tabs.remove(tab?.id).catch(() => {});
      const error = retryableError(`${detail.reason || 'launch-failed'}-replacement-budget-exhausted`, 0, true);
      throw error;
    }
    await chrome.tabs.remove(tab?.id).catch(() => {});
    await progressCommand(command, workerId, guard.replacementProgress(command.progress, detail.reason || 'launch-failed'));
    throw retryableError(detail.reason || 'launch-failed', guard.retryDelay(detail.reason, command.attempts));
  }

  async function handleRateLimitedLaunch(command, workerId, tab, detail = {}) {
    const guard = globalThis.ChatSentinelTabLaunchGuard;
    const requestRate = globalThis.ChatSentinelRequestRateLimit;
    const state = await requestRate?.recordRateLimit?.(
      chrome.storage.local,
      detail.requestRateLimitIncidentKey || ('launch:' + String(tab?.id || 'unknown') + ':' + String(command.commandId || ''))
    );
    const count = Number(command.progress?.rateLimitRecheckCount || 0);
    if (!guard.rateLimitRecheckAllowed(count)) {
      await chrome.tabs.remove(tab?.id).catch(() => {});
      await progressCommand(command, workerId, { tabId: null, step: 'launch-rate-limit-exhausted' });
      throw retryableError('chatgpt-rate-limit-budget-exhausted', 0, true);
    }
    await progressCommand(command, workerId, guard.rateLimitProgress(command.progress));
    const adaptiveDelay = Math.max(
      guard.retryDelay('chatgpt-rate-limited', command.attempts),
      Math.min(60_000, Math.max(0, Number(state?.cooldownUntil || 0) - Date.now()))
    );
    throw retryableError('chatgpt-rate-limited', adaptiveDelay);
  }

  function isRateSensitiveCommand(type) {
    return RATE_SENSITIVE_TYPES.includes(String(type || ''));
  }

  async function enforceRequestRateGate() {
    const requestRate = globalThis.ChatSentinelRequestRateLimit;
    const gate = await requestRate?.gate?.(chrome.storage.local) || { allowed: true, waitMs: 0 };
    if (gate.allowed) return gate;
    throw retryableError('request-rate-limit-cooldown', Math.min(60_000, Math.max(1000, Number(gate.waitMs || 0))));
  }

  async function reviveDiscardedTab(tab) {
    if (!tab?.discarded) return tab;
    await chrome.tabs.reload(tab.id);
    await sleep(1200);
    return await safeGetTab(tab.id) || tab;
  }

  function retryableError(message, retryAfterMs, terminal = false) {
    const error = new Error(message);
    error.retryAfterMs = retryAfterMs;
    error.terminal = terminal;
    return error;
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
          files: ['components/runtime-context-guard/controller.js', 'components/request-rate-limit/controller.js', 'components/chat-experience-guard/controller.js', 'components/tab-launch-guard/controller.js', 'components/message-delivery-recovery/controller.js', 'components/prompt-delivery/controller.js', 'components/response-completion-recovery/controller.js', 'identity.js', 'actuator.js', 'content.js', 'components/project-chat-lifecycle/controller.js', 'components/full-project-mode/controller.js', 'project-console.js', 'components/offline-recovery/controller.js']
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
