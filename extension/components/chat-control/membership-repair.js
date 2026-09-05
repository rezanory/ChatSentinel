(() => {
  async function repairStaleFocus({ command, result }, adapter) {
    const payload = command?.payload || {};
    if (!result?.staleRecovered || !result?.tabId) return result;
    if (!payload.projectId || !payload.conversationId) return result;

    const project = await adapter.getProject(payload.projectId);
    if (!project) throw new Error('project-not-found');
    const existing = (project.chats || []).find(chat => chat.conversationId === payload.conversationId)
      || (project.chats || []).find(chat => Number(chat.tabId) === Number(payload.tabId));
    const tab = await adapter.getTab(result.tabId);
    const attached = await adapter.attach({
      projectId: payload.projectId,
      conversationId: payload.conversationId,
      tabId: result.tabId,
      title: existing?.title || tab?.title || payload.title,
      url: tab?.url || existing?.url || payload.url,
      laneId: existing?.laneId || payload.laneId,
      laneName: existing?.laneName || payload.laneName,
      branch: existing?.branch || payload.branch,
      role: existing?.role || payload.role
    });
    if (!attached?.ok) throw new Error(attached?.error || 'stale-focus-reattach-failed');

    let regrouped = false;
    if (project.groupTabs !== false && adapter.groupProjectTabs) {
      try {
        const refreshed = await adapter.getProject(payload.projectId);
        regrouped = Boolean((await adapter.groupProjectTabs(refreshed))?.ok);
      } catch {}
    }

    return { ...result, membershipRepaired: true, regrouped };
  }

  globalThis.ChatSentinelChatMembershipRepair = { repairStaleFocus };
})();
