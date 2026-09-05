(() => {
  const DEFAULT_FRESH_MS = 180000;
  const TERMINAL_STATES = new Set(['COMPLETE', 'DEAD']);

  function projectActiveChats(projects = [], options = {}) {
    const liveTabIds = new Set((options.liveTabIds || []).map(Number).filter(Number.isInteger));
    const activeTabIds = new Set((options.activeTabIds || []).map(Number).filter(Number.isInteger));
    const nowMs = Number.isFinite(Number(options.nowMs)) ? Number(options.nowMs) : Date.now();
    const freshMs = Math.max(60000, Number(options.freshMs) || DEFAULT_FRESH_MS);
    return (projects || []).map(project => {
      const registeredChats = Array.isArray(project?.chats) ? project.chats : [];
      const chats = registeredChats.filter(chat => isActiveChat(chat, { liveTabIds, activeTabIds, nowMs, freshMs }));
      return {
        ...project,
        chats,
        chatCount: chats.length,
        registeredChatCount: registeredChats.length,
        inactiveChatCount: Math.max(0, registeredChats.length - chats.length)
      };
    });
  }

  function isActiveChat(chat, { liveTabIds, activeTabIds, nowMs, freshMs }) {
    const tabId = Number(chat?.tabId);
    if (!Number.isInteger(tabId) || !liveTabIds.has(tabId)) return false;
    if (TERMINAL_STATES.has(String(chat?.state || '').toUpperCase())) return false;
    if (chat?.conversationDead === true) return false;
    if (activeTabIds.has(tabId)) return true;
    const attachedAtMs = Date.parse(chat?.attachedAt || '');
    if (Number.isFinite(attachedAtMs) && Math.max(0, nowMs - attachedAtMs) <= freshMs) return true;
    const updatedAtMs = Date.parse(chat?.updatedAt || '');
    if (!Number.isFinite(updatedAtMs)) return true;
    const fresh = Math.max(0, nowMs - updatedAtMs) <= freshMs;
    if (!fresh) return false;
    const state = String(chat?.state || '').toUpperCase();
    const action = String(chat?.decision?.action || 'WAIT').toUpperCase();
    return state === 'RUNNING' || action !== 'WAIT';
  }

  function membershipsForClosedTab(projects = [], tabId) {
    const target = Number(tabId);
    if (!Number.isInteger(target)) return [];
    const rows = [];
    const seen = new Set();
    for (const project of projects || []) {
      for (const chat of project?.chats || []) {
        if (Number(chat?.tabId) !== target) continue;
        const conversationId = String(chat?.conversationId || '').trim();
        if (!conversationId || seen.has(conversationId)) continue;
        seen.add(conversationId);
        rows.push({ projectId: project.projectId, conversationId, tabId: target });
      }
    }
    return rows;
  }

  globalThis.ChatSentinelProjectChatLifecycle = Object.freeze({
    DEFAULT_FRESH_MS,
    projectActiveChats,
    isActiveChat,
    membershipsForClosedTab
  });
})();
