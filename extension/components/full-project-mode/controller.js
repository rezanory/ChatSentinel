(() => {
  const COMMAND = 'CHATSENTINEL FULL PROJECT MODE';

  async function activate(context = {}, adapters = {}) {
    const conversationId = String(context.conversationId || '').trim();
    if (!conversationId) return { ok: false, error: 'conversationId-required' };
    if (typeof adapters.api !== 'function') return { ok: false, error: 'api-adapter-required' };

    const activation = await adapters.api('/full-project-mode/activate', 'POST', {
      conversationId,
      selectedProjectId: context.selectedProjectId || undefined,
      projectDraft: context.projectDraft || undefined,
      tabId: context.tab?.tabId,
      title: context.tab?.title,
      url: context.tab?.url
    });
    if (!activation?.ok) return activation || { ok: false, error: 'activation-failed' };

    let activeProject = activation.project;
    const projects = await adapters.api('/projects').catch(() => null);
    const hydrated = projects?.projects?.find(project =>
      project.projectId === activation.project?.projectId);
    if (hydrated) activeProject = hydrated;

    const completion = { grouped: false, snapshotCaptured: false };
    if (activeProject?.groupTabs !== false && typeof adapters.groupTabs === 'function') {
      const grouped = await adapters.groupTabs(activeProject).catch(() => null);
      completion.grouped = Boolean(grouped?.ok);
    }
    if (activation.profile?.sessionSnapshots && typeof adapters.captureSnapshot === 'function') {
      const snapshot = await adapters.captureSnapshot(activeProject.projectId).catch(() => null);
      completion.snapshotCaptured = Boolean(snapshot?.ok);
    }

    const prompt = typeof adapters.prependPrompt === 'function'
      ? adapters.prependPrompt(COMMAND)
      : { ok: false, reason: 'actuator-missing' };

    return {
      ...activation,
      project: activeProject,
      ok: true,
      prompt,
      completion,
      activated: true
    };
  }

  function draftFromEditor(shadow) {
    if (!shadow) return null;
    const projectPath = shadow.getElementById('pPath')?.value?.trim();
    if (!projectPath) return null;
    return {
      name: shadow.getElementById('pName')?.value?.trim() || '',
      projectPath,
      folderPath: shadow.getElementById('pFolder')?.value?.trim() || '',
      operationClass: shadow.getElementById('pPolicy')?.value || '',
      color: shadow.getElementById('pColor')?.value || 'blue'
    };
  }

  globalThis.ChatSentinelFullProjectMode = Object.freeze({
    COMMAND,
    activate,
    draftFromEditor
  });
})();
