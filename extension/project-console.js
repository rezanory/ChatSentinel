/*
 * ChatSentinel in-page project console.
 * Docking/resizing interaction is adapted from Sami21234/Chatgpt-Sidebar (MIT).
 * ChatSentinel uses Shadow DOM isolation and its own project/recovery model.
 */
(() => {
  document.documentElement.dataset.chatsentinelConsoleReady = '1';
  const HOST_ID = 'chatsentinel-project-console-host';
  const MIN_WIDTH = 330;
  const MAX_WIDTH = 680;
  let host;
  let shadow;
  let boundShadow = null;
  let state = {
    open: false,
    tab: null,
    identity: null,
    conversationId: null,
    context: null,
    projects: [],
    projectTree: null,
    history: [],
    selectedProjectId: null,
    searchResults: [],
    importBundle: null,
    importPreview: null,
    setupPlan: null,
    rdcStatus: null
  };

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type !== 'CHATSENTINEL_TOGGLE_PANEL') return;
    togglePanel().then(() => sendResponse({ ok: true, open: state.open }))
      .catch(error => sendResponse({ ok: false, error: String(error) }));
    return true;
  });

  async function togglePanel() {
    ensurePanel();
    state.open = !state.open;
    host.style.display = state.open ? 'block' : 'none';
    if (state.open) await refresh();
  }

  function ensurePanel() {
    host = document.getElementById(HOST_ID);
    if (host?.shadowRoot) {
      shadow = host.shadowRoot;
      bindPanelEventsOnce();
      return;
    }
    host = document.createElement('div');
    host.id = HOST_ID;
    host.style.cssText = 'position:fixed;top:0;right:0;width:410px;height:100vh;z-index:2147483646;display:none;';
    shadow = host.attachShadow({ mode: 'open' });
    shadow.innerHTML = template();
    document.documentElement.appendChild(host);
    bindPanelEventsOnce();
  }

  function bindPanelEventsOnce() {
    if (!shadow || boundShadow === shadow) return;
    bindEvents();
    restorePanelWidth();
    boundShadow = shadow;
  }

  function template() {
    return `
      <style>
        :host { all: initial; color-scheme: light dark; }
        * { box-sizing: border-box; }
        .shell { position:relative; height:100vh; display:flex; flex-direction:column; font:13px/1.4 system-ui,-apple-system,Segoe UI,sans-serif; background:#111827; color:#f3f4f6; border-left:1px solid #374151; box-shadow:-12px 0 32px rgba(0,0,0,.28); }
        .resize { position:absolute; left:-5px; top:0; width:10px; height:100%; cursor:ew-resize; z-index:5; }
        .header { display:flex; align-items:center; gap:8px; padding:12px 14px; border-bottom:1px solid #374151; background:#0f172a; }
        .title { font-weight:700; font-size:15px; flex:1; }
        .badge { font-size:11px; color:#86efac; }
        button,input,select { font:inherit; }
        button { cursor:pointer; border:1px solid #4b5563; border-radius:8px; padding:7px 10px; background:#1f2937; color:#f9fafb; }
        button:hover { background:#374151; }
        button.primary { background:#2563eb; border-color:#2563eb; }
        button.danger { background:#3f1d23; border-color:#7f1d1d; }
        button:disabled { opacity:.45; cursor:not-allowed; }
        .body { overflow:auto; padding:12px; display:flex; flex-direction:column; gap:12px; }
        .card { border:1px solid #374151; border-radius:10px; padding:10px; background:#111827; }
        .card h3 { margin:0 0 8px; font-size:12px; color:#d1d5db; text-transform:uppercase; letter-spacing:.04em; }
        .row { display:flex; gap:8px; align-items:center; }
        .row + .row { margin-top:8px; }
        .field { display:flex; flex-direction:column; gap:4px; margin-top:8px; }
        .field label { color:#9ca3af; font-size:11px; }
        input,select { width:100%; border:1px solid #4b5563; border-radius:7px; padding:7px 8px; background:#0f172a; color:#f9fafb; }
        .muted { color:#9ca3af; font-size:11px; }
        .ok { color:#86efac; }.warn { color:#fbbf24; }.bad { color:#fca5a5; }
        .projects { display:flex; flex-direction:column; gap:5px; }
        .folder { margin-left:10px; border-left:1px solid #334155; padding-left:8px; }
        .folder-name { color:#93c5fd; font-size:11px; font-weight:700; margin:4px 0; }
        .history-row { padding:7px 0; border-top:1px solid #263244; }
        .history-row:first-child { border-top:0; }
        .project-chip.active { border-color:#60a5fa; background:#1e3a8a; }
        .chat { display:grid; grid-template-columns:1fr auto; gap:8px; padding:8px 0; border-top:1px solid #263244; }
        .chat:first-child { border-top:0; }
        .chat-title { font-weight:600; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
        .decision { font-size:11px; color:#93c5fd; }
        .footer { padding:8px 12px; border-top:1px solid #374151; color:#6b7280; font-size:10px; }
      </style>
      <div class="shell">
        <div class="resize" id="resize"></div>
        <div class="header">
          <div class="title">ChatSentinel</div>
          <div class="badge" id="health">connecting…</div>
          <button id="close" title="Close">×</button>
        </div>
        <div class="body">
          <div class="card" id="currentCard"></div>
          <div class="card" id="setupCard"></div>
          <div class="card" id="rdcRecoveryCard"></div>
          <div class="card">
            <h3>Projects</h3>
            <div class="projects" id="projectList"></div>
            <div class="row" style="margin-top:8px"><button id="newProject">+ New project</button></div>
          </div>
          <div class="card" id="projectEditor"></div>
          <div class="card" id="chatGroup"></div>
          <div class="card" id="searchPortable"></div>
          <div class="card" id="historyCard"></div>
        </div>
        <div class="footer" id="footerVersion">local-first project watchdog</div>
      </div>`;
  }

  function bindEvents() {
    shadow.getElementById('close').addEventListener('click', () => {
      state.open = false;
      host.style.display = 'none';
    });
    shadow.getElementById('newProject').addEventListener('click', () => {
      state.selectedProjectId = null;
      renderProjectEditor(null);
    });
    bindResize(shadow.getElementById('resize'));
  }

  async function refresh() {
    const tab = await runtime({ type: 'CHATSENTINEL_TAB_CONTEXT' });
    state.tab = tab;
    state.identity = window.ChatSentinelIdentity?.resolve?.() || null;
    state.conversationId = state.identity?.id || (tab?.tabId ? `tab:${tab.tabId}` : 'unknown');

    const context = await api(`/project/context?conversationId=${encodeURIComponent(state.conversationId)}`);
    state.context = context;
    const treeResult = await api('/projects/tree');
    const rawProjects = treeResult.projects || context.projects || [];
    const tabIds = rawProjects.flatMap(project => (project.chats || []).map(chat => chat.tabId)).filter(tabId => Number.isInteger(Number(tabId)));
    const liveTabs = await runtime({ type: 'CHATSENTINEL_LIVE_TAB_IDS', tabIds });
    const lifecycle = globalThis.ChatSentinelProjectChatLifecycle;
    state.projects = liveTabs?.ok && lifecycle?.projectActiveChats
      ? lifecycle.projectActiveChats(rawProjects, { liveTabIds: liveTabs.tabIds, activeTabIds: liveTabs.activeTabIds })
      : rawProjects;
    state.projectTree = treeResult.tree || null;
    const historyResult = await api('/audit/history?limit=100');
    state.history = historyResult.events || [];
    if (!state.selectedProjectId && context.project?.projectId) state.selectedProjectId = context.project.projectId;
    else if (state.selectedProjectId && !state.projects.some(project => project.projectId === state.selectedProjectId)) state.selectedProjectId = context.project?.projectId || null;

    state.setupPlan = await api('/setup/plan?service=1');
    state.rdcStatus = await api('/recovery/remote-desktop-commander').catch(() => ({ ok: false, supported: true, running: false }));
    const health = await api('/health');
    const healthEl = shadow.getElementById('health');
    healthEl.textContent = health.ok ? `v${health.version} online` : 'offline';
    healthEl.className = health.ok ? 'badge ok' : 'badge bad';
    const footerVersion = shadow.getElementById('footerVersion');
    if (footerVersion) footerVersion.textContent = health.ok ? `v${health.version} · local-first project watchdog` : 'local-first project watchdog';

    renderCurrent();
    renderSetup();
    renderRemoteDesktopCommanderRecovery();
    renderProjects();
    renderProjectEditor(selectedProject());
    renderChatGroup(selectedProject());
    renderSearchPortable();
    renderHistory(selectedProject());
  }

  function renderCurrent() {
    const project = state.context?.project;
    const source = state.identity?.source || 'tab-fallback';
    const card = shadow.getElementById('currentCard');
    card.innerHTML = `
      <h3>Current ChatGPT chat</h3>
      <div class="chat-title">${escapeHtml(state.tab?.title || 'ChatGPT')}</div>
      <div class="muted">${escapeHtml(state.conversationId)} · ${escapeHtml(source)}</div>
      <div class="row" style="margin-top:8px">
        <span class="muted">Project:</span>
        <strong>${escapeHtml(project?.name || 'not attached')}</strong>
      </div>
      <div class="row" style="margin-top:8px">
        <label><input id="globalAuto" type="checkbox" style="width:auto"> Global auto-recovery master</label>
      </div>
      <div class="row" style="margin-top:8px">
        <button class="primary" id="insertFullProjectMode">Activate Full Project Mode</button>
        <span class="muted" id="fullProjectModeStatus"></span>
      </div>`;
    chrome.storage.local.get(['autoRecoveryEnabled']).then(values => {
      const checkbox = shadow.getElementById('globalAuto');
      if (!checkbox) return;
      checkbox.checked = Boolean(values.autoRecoveryEnabled);
      checkbox.addEventListener('change', () => chrome.storage.local.set({ autoRecoveryEnabled: checkbox.checked }));
    });
    const modeStatus = shadow.getElementById('fullProjectModeStatus');
    if (project?.fullProjectMode?.active && modeStatus) {
      const pathState = project.fullProjectMode.orchestrationActivation?.state || 'ready-for-plan';
      modeStatus.textContent = `Active - orchestration ${pathState}`;
      modeStatus.className = 'ok';
    }
    shadow.getElementById('insertFullProjectMode')?.addEventListener('click', async () => {
      const status = shadow.getElementById('fullProjectModeStatus');
      if (status) { status.textContent = 'Activating...'; status.className = 'muted'; }
      const controller = window.ChatSentinelFullProjectMode;
      const result = await controller?.activate?.({
        conversationId: state.conversationId,
        selectedProjectId: state.context?.project?.projectId || state.selectedProjectId || undefined,
        projectDraft: controller?.draftFromEditor?.(shadow),
        tab: state.tab
      }, {
        api,
        groupTabs: projectRow => runtime({ type: 'CHATSENTINEL_GROUP_PROJECT_TABS', project: projectRow }),
        captureSnapshot: projectId => runtime({ type: 'CHATSENTINEL_CAPTURE_SESSION_SNAPSHOT', projectId, reason: 'full-project-mode-activation' }),
        prependPrompt: text => window.ChatSentinelActuator?.prependPromptText?.(text) || { ok: false, reason: 'actuator-missing' }
      }) || { ok: false, error: 'full-project-mode-controller-missing' };
      if (!result.ok) {
        if (status) {
          status.textContent = result.error === 'project-selection-required'
            ? 'Select a project or enter a local project path first'
            : (result.error || 'Activation failed');
          status.className = 'bad';
        }
        return;
      }
      state.selectedProjectId = result.project?.projectId || state.selectedProjectId;
      await refresh();
    });
  }

  function renderSetup() {
    const card = shadow.getElementById('setupCard');
    const plan = state.setupPlan || {};
    const report = plan.report || {};
    const prereq = report.prerequisites || {};
    const missing = ['node', 'git', 'chrome', 'gh'].filter(id => prereq[id] && !prereq[id].installed);
    const profile = report.profile || {};
    const rows = ['node', 'git', 'chrome', 'gh'].map(id => {
      const row = prereq[id] || {};
      const label = id === 'gh' ? 'GitHub CLI' : id === 'chrome' ? 'Chrome' : id === 'node' ? 'Node.js' : 'Git';
      const suffix = row.version ? ` ${row.version}` : '';
      return `<span class="${row.installed ? 'ok' : 'warn'}">${row.installed ? 'OK' : 'MISSING'} ${label}${escapeHtml(suffix)}</span>`;
    }).join('<br>');
    card.innerHTML = `
      <h3>Environment Setup</h3>
      <div class="muted">${escapeHtml(profile.platform || 'unknown')} / ${escapeHtml(profile.arch || 'unknown')}</div>
      <div style="margin-top:6px">${rows}</div>
      <div class="muted" style="margin-top:7px">${missing.length ? `Missing: ${escapeHtml(missing.join(', '))}` : 'Required prerequisites detected.'}</div>
      <div class="field"><label>Bootstrap command</label><input id="bootstrapCommand" readonly value="${escapeAttr(plan.bootstrapHint || '')}"></div>
      <div class="row" style="margin-top:8px"><button id="copyBootstrap">Copy setup command</button><button id="refreshSetup">Refresh</button><button id="openSetupAssistant">Setup Assistant</button></div>
      <div class="muted">System installs require approval through the local ChatSentinel Setup Bridge.</div>`;
    shadow.getElementById('refreshSetup')?.addEventListener('click', refresh);
    shadow.getElementById('openSetupAssistant')?.addEventListener('click', () => chrome.runtime.openOptionsPage());
    shadow.getElementById('copyBootstrap')?.addEventListener('click', async () => {
      const input = shadow.getElementById('bootstrapCommand');
      const text = input?.value || '';
      if (!text) return;
      try { await navigator.clipboard.writeText(text); }
      catch { input?.select?.(); document.execCommand?.('copy'); }
    });
  }


  function renderRemoteDesktopCommanderRecovery() {
    const card = shadow.getElementById('rdcRecoveryCard');
    if (!card) return;
    const status = state.rdcStatus || {};
    const supported = status.supported === true;
    const running = Boolean(status.running);
    const trusted = status.validated === true && status.installed === true;
    const stateLabel = status.ok === false && status.error
      ? status.error
      : !supported
      ? 'Unsupported on this platform'
      : !status.installed
        ? 'Lightweight agent task not found'
        : !status.validated
          ? 'Agent task failed safety validation'
          : running ? 'Connected agent process is running' : `Agent is ${status.state || 'offline'}`;
    const cls = running ? 'ok' : (trusted ? 'warn' : 'bad');
    card.innerHTML = `
      <h3>Remote Desktop Commander</h3>
      <div class="${cls}" id="rdcRecoveryStatus">${escapeHtml(stateLabel)}</div>
      <div class="muted" style="margin-top:6px">Use after Chrome/site session cleanup, lost pairing, or when Remote Desktop Commander stops receiving commands.</div>
      <div class="row" style="margin-top:8px">
        <button class="primary" id="recoverRdc" ${supported && trusted ? '' : 'disabled'}>Recover Remote Desktop Commander</button>
        <button id="checkRdc">Check</button>
      </div>
      <div class="muted" style="margin-top:6px">Recovery only restarts the validated lightweight @wonderwhy-er/desktop-commander agent. It does not launch Desktop Commander GUI.</div>`;

    shadow.getElementById('checkRdc')?.addEventListener('click', async () => {
      const statusEl = shadow.getElementById('rdcRecoveryStatus');
      if (statusEl) { statusEl.textContent = 'Checking...'; statusEl.className = 'muted'; }
      state.rdcStatus = await api('/recovery/remote-desktop-commander').catch(error => ({ ok: false, error: String(error) }));
      renderRemoteDesktopCommanderRecovery();
    });

    shadow.getElementById('recoverRdc')?.addEventListener('click', async () => {
      const button = shadow.getElementById('recoverRdc');
      const statusEl = shadow.getElementById('rdcRecoveryStatus');
      if (button) button.disabled = true;
      if (statusEl) { statusEl.textContent = 'Restarting lightweight agent...'; statusEl.className = 'muted'; }
      const result = await api('/recovery/remote-desktop-commander', 'POST', { reason: 'manual-panel-recovery' }).catch(error => ({ ok: false, error: String(error) }));
      state.rdcStatus = result;
      if (result.ok && result.running) {
        if (statusEl) { statusEl.textContent = 'Agent restarted. Complete browser authorization if prompted.'; statusEl.className = 'ok'; }
        setTimeout(() => refresh().catch(() => {}), 1200);
        return;
      }
      if (statusEl) { statusEl.textContent = result.error || 'Recovery failed'; statusEl.className = 'bad'; }
      if (button) button.disabled = false;
    });
  }

  function renderProjects() {
    const list = shadow.getElementById('projectList');
    list.replaceChildren();
    if (!state.projects.length) {
      const empty = document.createElement('span');
      empty.className = 'muted';
      empty.textContent = 'No projects yet.';
      list.append(empty);
      return;
    }
    renderTreeNode(list, state.projectTree || { folders: [], projects: state.projects });
  }

  function renderProjectEditor(project) {
    const editor = shadow.getElementById('projectEditor');
    const isNew = !project;
    const values = project || {
      name: '', projectPath: '', folderPath: '', operationClass: '', autoRecovery: false, groupTabs: true, color: 'blue'
    };
    editor.innerHTML = `
      <h3>${isNew ? 'Create Project' : 'Project Settings'}</h3>
      <div class="field"><label>Name</label><input id="pName" value="${escapeAttr(values.name || '')}"></div>
      <div class="field"><label>Local project path</label><input id="pPath" value="${escapeAttr(values.projectPath || '')}" placeholder="C:\\Project"></div>
      <div class="field"><label>Folder path</label><input id="pFolder" value="${escapeAttr(values.folderPath || '')}" placeholder="Client / Product / Phase"></div>
      <div class="field"><label>Operation policy</label>
        <select id="pPolicy">
          <option value="" ${selected(values.operationClass,'')}>Conservative / auto</option>
          <option value="read_only" ${selected(values.operationClass,'read_only')}>Read-only / idempotent</option>
          <option value="write" ${selected(values.operationClass,'write')}>Write / side effects possible</option>
        </select>
      </div>
      <div class="field"><label>Chrome tab-group color</label>
        <select id="pColor">${colorOptions(values.color)}</select>
      </div>
      <div class="row"><label><input id="pAuto" type="checkbox" style="width:auto" ${values.autoRecovery ? 'checked' : ''}> Auto recovery for this project</label></div>
      <div class="row"><label><input id="pGroup" type="checkbox" style="width:auto" ${values.groupTabs !== false ? 'checked' : ''}> Group parallel chats in Chrome</label></div>
      <div class="row" style="margin-top:10px">
        <button class="primary" id="saveProject">${isNew ? 'Create' : 'Save'}</button>
        <button id="attachChat" ${isNew ? 'disabled' : ''}>Attach this chat</button>
        ${!isNew && state.context?.project?.projectId === project.projectId ? '<button id="detachChat">Detach this chat</button>' : ''}
        ${!isNew ? '<button class="danger" id="deleteProject">Delete</button>' : ''}
      </div>
      <div class="muted" id="projectStatus"></div>`;

    shadow.getElementById('saveProject').addEventListener('click', () => saveProject(project));
    if (!isNew) shadow.getElementById('attachChat').addEventListener('click', () => attachCurrent(project));
    shadow.getElementById('detachChat')?.addEventListener('click', detachCurrent);
    shadow.getElementById('deleteProject')?.addEventListener('click', () => deleteProject(project));
  }

  async function saveProject(existing) {
    const status = shadow.getElementById('projectStatus');
    status.textContent = 'Saving…';
    const payload = {
      projectId: existing?.projectId,
      name: shadow.getElementById('pName').value.trim(),
      projectPath: shadow.getElementById('pPath').value.trim(),
      folderPath: shadow.getElementById('pFolder').value.trim(),
      operationClass: shadow.getElementById('pPolicy').value,
      color: shadow.getElementById('pColor').value,
      autoRecovery: shadow.getElementById('pAuto').checked,
      groupTabs: shadow.getElementById('pGroup').checked
    };
    const result = await api('/projects/upsert', 'POST', payload);
    if (!result.ok) {
      status.textContent = result.error || 'Save failed';
      status.className = 'bad';
      return;
    }
    state.selectedProjectId = result.project.projectId;
    status.textContent = 'Saved';
    status.className = 'ok';
    await refresh();
  }

  async function attachCurrent(project) {
    const result = await api('/projects/attach', 'POST', {
      projectId: project.projectId,
      conversationId: state.conversationId,
      tabId: state.tab?.tabId,
      title: state.tab?.title,
      url: state.tab?.url
    });
    if (result.ok && project.groupTabs !== false) {
      const updated = (result.projects || []).find(item => item.projectId === project.projectId) || project;
      await runtime({ type: 'CHATSENTINEL_GROUP_PROJECT_TABS', project: updated });
    }
    await refresh();
  }

  async function detachCurrent() {
    await api('/projects/detach', 'POST', { conversationId: state.conversationId });
    await refresh();
  }

  async function deleteProject(project) {
    if (!confirm(`Delete ChatSentinel project “${project.name}”?`)) return;
    await api('/projects/delete', 'POST', { projectId: project.projectId });
    state.selectedProjectId = null;
    await refresh();
  }

  function renderChatGroup(project) {
    const group = shadow.getElementById('chatGroup');
    if (!project) {
      group.innerHTML = '<h3>Parallel Chats</h3><div class="muted">Select a project to see its chat group.</div>';
      return;
    }

    const chats = project.chats || [];
    const hiddenCount = Number(project.inactiveChatCount || 0);
    group.innerHTML = `
      <h3>${escapeHtml(project.name)} - Active Parallel Chats</h3>
      <div class="row">
        <button class="primary" id="newProjectChat">+ New project chat</button>
        <button id="groupTabs">Group open tabs</button>
      </div>
      ${hiddenCount ? `<div class="muted" style="margin-top:8px">${hiddenCount} inactive / stale registered chat${hiddenCount === 1 ? '' : 's'} hidden from the active view.</div>` : ''}
      <div id="chatList" style="margin-top:8px"></div>`;

    shadow.getElementById('newProjectChat').addEventListener('click', () => {
      runtime({ type: 'CHATSENTINEL_NEW_PROJECT_CHAT', project });
    });
    shadow.getElementById('groupTabs').addEventListener('click', () => {
      runtime({ type: 'CHATSENTINEL_GROUP_PROJECT_TABS', project });
    });

    const list = shadow.getElementById('chatList');
    if (!chats.length) {
      list.innerHTML = '<div class="muted">No active parallel chats.</div>';
      return;
    }

    for (const chat of chats) {
      const row = document.createElement('div');
      row.className = 'chat';
      const status = `${chat.state || 'UNKNOWN'} · ${chat.decision?.action || '—'}`;
      row.innerHTML = `
        <div>
          <div class="chat-title">${escapeHtml(chat.title || chat.conversationId)}</div>
          <div class="decision">${escapeHtml(status)}</div>
          <div class="muted">risk=${escapeHtml(chat.sideEffectRisk || 'unknown')} · ${chat.checkpointFresh ? 'checkpoint fresh' : 'checkpoint uncertain'}</div>
        </div>
        <button class="focusChat" ${chat.tabId ? '' : 'disabled'}>Open</button>`;
      row.querySelector('.focusChat').addEventListener('click', async () => {
        await runtime({ type: 'CHATSENTINEL_FOCUS_TAB', tabId: chat.tabId, url: chat.url });
      });
      list.append(row);
    }
  }

  function renderTreeNode(container, node) {
    for (const folder of node.folders || []) {
      const wrap = document.createElement('div');
      wrap.className = 'folder';
      const label = document.createElement('div');
      label.className = 'folder-name';
      label.textContent = `📁 ${folder.name}`;
      wrap.append(label);
      renderTreeNode(wrap, folder);
      container.append(wrap);
    }
    for (const treeProject of node.projects || []) {
      const project = state.projects.find(row => row.projectId === treeProject.projectId) || treeProject;
      const button = document.createElement('button');
      button.className = `project-chip${project.projectId === state.selectedProjectId ? ' active' : ''}`;
      button.textContent = `${project.name} · ${project.chatCount || 0}`;
      button.addEventListener('click', () => {
        state.selectedProjectId = project.projectId;
        renderProjects();
        renderProjectEditor(project);
        renderChatGroup(project);
        renderHistory(project);
      });
      container.append(button);
    }
  }

  function renderHistory(project) {
    const card = shadow.getElementById('historyCard');
    const events = state.history.filter(event => !project || event.projectId === project.projectId).slice(0, 30);
    card.innerHTML = `<h3>${project ? escapeHtml(project.name) + ' · ' : ''}Action / Recovery History</h3><div id="historyList"></div>`;
    const list = card.querySelector('#historyList');
    if (!events.length) {
      list.innerHTML = '<div class="muted">No recorded actions or recovery decisions yet.</div>';
      return;
    }
    for (const event of events) {
      const row = document.createElement('div');
      row.className = 'history-row';
      row.innerHTML = `<div><strong>${escapeHtml(event.action)}</strong> <span class="muted">${escapeHtml(event.outcome)}</span></div><div class="muted">${escapeHtml(event.projectName || event.conversationId || 'global')} · ${escapeHtml(event.at || '')}</div>${event.reason ? `<div class="muted">${escapeHtml(event.reason)}</div>` : ''}`;
      list.append(row);
    }
  }

  function renderSearchPortable() {
    const card = shadow.getElementById('searchPortable');
    const preview = state.importPreview?.preview;
    card.innerHTML = `
      <h3>Search · Export · Import</h3>
      <div class="row">
        <input id="searchQuery" placeholder="Search projects and chats">
        <select id="searchState"><option value="">Any state</option><option>RUNNING</option><option>STALLED</option><option>INTERRUPTED</option><option>DEAD</option><option>COMPLETE</option></select>
        <button id="runSearch">Search</button>
      </div>
      <div id="searchResults" style="margin-top:8px"></div>
      <div class="row" style="margin-top:10px">
        <button id="exportProject">Export selected project</button>
        <button id="importProject">Import bundle</button>
        <input id="importFile" type="file" accept="application/json,.json" style="display:none">
      </div>
      <div id="importStatus" class="muted" style="margin-top:8px">${preview ? escapeHtml(`Preview: +${preview.projectsCreate} projects, ${preview.projectsUpdate} updates, +${preview.configsCreate} chats, ${preview.conflicts.length} conflicts`) : 'Import is previewed before any changes are applied.'}</div>
      ${preview ? '<div class="row" style="margin-top:8px"><label><input id="applySnapshots" type="checkbox" style="width:auto"> Apply recovery snapshots</label><button class="primary" id="applyImport">Apply reviewed import</button></div>' : ''}`;
    shadow.getElementById('runSearch').addEventListener('click', runSearch);
    shadow.getElementById('exportProject').addEventListener('click', exportProject);
    shadow.getElementById('importProject').addEventListener('click', () => shadow.getElementById('importFile').click());
    shadow.getElementById('importFile').addEventListener('change', previewImportFile);
    shadow.getElementById('applyImport')?.addEventListener('click', applyReviewedImport);
    renderSearchResults();
  }

  async function runSearch() {
    const query = shadow.getElementById('searchQuery').value.trim();
    const searchState = shadow.getElementById('searchState').value;
    const params = new URLSearchParams({ query, state: searchState });
    const project = selectedProject();
    if (project?.projectId) params.set('projectId', project.projectId);
    const result = await api(`/search?${params}`);
    state.searchResults = result.ok ? result.results : [];
    renderSearchResults();
  }

  function renderSearchResults() {
    const list = shadow.getElementById('searchResults');
    if (!list) return;
    if (!state.searchResults.length) {
      list.innerHTML = '<div class="muted">No search results yet.</div>';
      return;
    }
    list.replaceChildren();
    for (const result of state.searchResults.slice(0, 50)) {
      const row = document.createElement('div');
      row.className = 'chat';
      row.innerHTML = `<div><div class="chat-title">${escapeHtml(result.title || result.conversationId)}</div><div class="decision">${escapeHtml(`${result.projectName || 'Unassigned'} · ${result.state} · ${result.action || '—'}`)}</div></div><button ${result.tabId ? '' : 'disabled'}>Open</button>`;
      row.querySelector('button').addEventListener('click', () => runtime({ type: 'CHATSENTINEL_FOCUS_TAB', tabId: result.tabId, url: result.url }));
      list.append(row);
    }
  }

  async function exportProject() {
    const project = selectedProject();
    const suffix = project?.projectId ? `?projectId=${encodeURIComponent(project.projectId)}` : '';
    const result = await api(`/portable/export${suffix}`);
    if (!result.ok) return;
    const blob = new Blob([JSON.stringify(result.bundle, null, 2)], { type: 'application/json' });
    const href = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = href;
    link.download = `chatsentinel-${project?.name || 'projects'}-${Date.now()}.json`;
    link.click();
    URL.revokeObjectURL(href);
  }

  async function previewImportFile(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      state.importBundle = JSON.parse(await file.text());
      const result = await api('/portable/import/preview', 'POST', { bundle: state.importBundle });
      state.importPreview = result.ok ? result : null;
      renderSearchPortable();
      if (!result.ok) shadow.getElementById('importStatus').textContent = result.error || 'Import validation failed';
    } catch {
      state.importBundle = null;
      state.importPreview = null;
      shadow.getElementById('importStatus').textContent = 'Invalid JSON import file';
    }
  }

  async function applyReviewedImport() {
    if (!state.importBundle || !state.importPreview?.previewToken) return;
    const result = await api('/portable/import/apply', 'POST', {
      bundle: state.importBundle,
      previewToken: state.importPreview.previewToken,
      applyRecoverySnapshots: Boolean(shadow.getElementById('applySnapshots')?.checked)
    });
    if (!result.ok) {
      shadow.getElementById('importStatus').textContent = result.error || 'Import failed';
      return;
    }
    state.importBundle = null;
    state.importPreview = null;
    await refresh();
  }

  function selectedProject() {
    return state.projects.find(project => project.projectId === state.selectedProjectId) || null;
  }

  async function api(route, method = 'GET', body) {
    return runtime({ type: 'CHATSENTINEL_API', route, method, body, pageUrl: location.href });
  }

  async function runtime(message) {
    const guard = globalThis.ChatSentinelRuntimeContext;
    if (!guard?.sendMessage) return { ok: false, invalidated: true, reason: 'extension-context-invalidated' };
    return guard.sendMessage(message);
  }

  function bindResize(handle) {
    let startX = 0;
    let startWidth = 0;
    handle.addEventListener('pointerdown', event => {
      startX = event.clientX;
      startWidth = host.getBoundingClientRect().width;
      handle.setPointerCapture(event.pointerId);
    });
    handle.addEventListener('pointermove', event => {
      if (!handle.hasPointerCapture(event.pointerId)) return;
      const width = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, startWidth + (startX - event.clientX)));
      host.style.width = `${width}px`;
    });
    handle.addEventListener('pointerup', async event => {
      if (!handle.hasPointerCapture(event.pointerId)) return;
      handle.releasePointerCapture(event.pointerId);
      const width = Math.round(host.getBoundingClientRect().width);
      await chrome.storage.local.set({ panelWidth: width });
    });
  }

  async function restorePanelWidth() {
    const values = await chrome.storage.local.get(['panelWidth']);
    const width = Number(values.panelWidth);
    if (Number.isFinite(width)) host.style.width = `${Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, width))}px`;
  }

  function selected(value, expected) {
    return String(value || '') === expected ? 'selected' : '';
  }

  function colorOptions(current) {
    const colors = ['grey','blue','red','yellow','green','pink','purple','cyan','orange'];
    return colors.map(color => `<option value="${color}" ${color === current ? 'selected' : ''}>${color}</option>`).join('');
  }

  function escapeHtml(value = '') {
    return String(value).replace(/[&<>"']/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[char]));
  }

  function escapeAttr(value = '') {
    return escapeHtml(value).replace(/`/g, '&#96;');
  }
})();
