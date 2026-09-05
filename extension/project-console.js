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
  let state = {
    open: false,
    tab: null,
    identity: null,
    conversationId: null,
    context: null,
    projects: [],
    selectedProjectId: null
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
      return;
    }
    host = document.createElement('div');
    host.id = HOST_ID;
    host.style.cssText = 'position:fixed;top:0;right:0;width:410px;height:100vh;z-index:2147483646;display:none;';
    shadow = host.attachShadow({ mode: 'open' });
    shadow.innerHTML = template();
    document.documentElement.appendChild(host);
    bindEvents();
    restorePanelWidth();
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
        .projects { display:flex; flex-wrap:wrap; gap:6px; }
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
          <div class="card">
            <h3>Projects</h3>
            <div class="projects" id="projectList"></div>
            <div class="row" style="margin-top:8px"><button id="newProject">+ New project</button></div>
          </div>
          <div class="card" id="projectEditor"></div>
          <div class="card" id="chatGroup"></div>
        </div>
        <div class="footer">v1.1 · local-first project watchdog</div>
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
    state.projects = context.projects || [];
    if (!state.selectedProjectId) state.selectedProjectId = context.project?.projectId || state.projects[0]?.projectId || null;

    const health = await api('/health');
    const healthEl = shadow.getElementById('health');
    healthEl.textContent = health.ok ? `v${health.version} online` : 'offline';
    healthEl.className = health.ok ? 'badge ok' : 'badge bad';

    renderCurrent();
    renderProjects();
    renderProjectEditor(selectedProject());
    renderChatGroup(selectedProject());
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
      </div>`;
    chrome.storage.local.get(['autoRecoveryEnabled']).then(values => {
      const checkbox = shadow.getElementById('globalAuto');
      if (!checkbox) return;
      checkbox.checked = Boolean(values.autoRecoveryEnabled);
      checkbox.addEventListener('change', () => chrome.storage.local.set({ autoRecoveryEnabled: checkbox.checked }));
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
    for (const project of state.projects) {
      const button = document.createElement('button');
      button.className = `project-chip${project.projectId === state.selectedProjectId ? ' active' : ''}`;
      button.textContent = `${project.name} · ${project.chatCount || 0}`;
      button.addEventListener('click', () => {
        state.selectedProjectId = project.projectId;
        renderProjects();
        renderProjectEditor(project);
        renderChatGroup(project);
      });
      list.append(button);
    }
  }

  function renderProjectEditor(project) {
    const editor = shadow.getElementById('projectEditor');
    const isNew = !project;
    const values = project || {
      name: '', projectPath: '', operationClass: '', autoRecovery: false, groupTabs: true, color: 'blue'
    };
    editor.innerHTML = `
      <h3>${isNew ? 'Create Project' : 'Project Settings'}</h3>
      <div class="field"><label>Name</label><input id="pName" value="${escapeAttr(values.name || '')}"></div>
      <div class="field"><label>Local project path</label><input id="pPath" value="${escapeAttr(values.projectPath || '')}" placeholder="C:\\Project"></div>
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
    group.innerHTML = `
      <h3>${escapeHtml(project.name)} · Parallel Chats</h3>
      <div class="row">
        <button class="primary" id="newProjectChat">+ New project chat</button>
        <button id="groupTabs">Group open tabs</button>
      </div>
      <div id="chatList" style="margin-top:8px"></div>`;

    shadow.getElementById('newProjectChat').addEventListener('click', () => {
      runtime({ type: 'CHATSENTINEL_NEW_PROJECT_CHAT', project });
    });
    shadow.getElementById('groupTabs').addEventListener('click', () => {
      runtime({ type: 'CHATSENTINEL_GROUP_PROJECT_TABS', project });
    });

    const list = shadow.getElementById('chatList');
    if (!chats.length) {
      list.innerHTML = '<div class="muted">No chats attached yet.</div>';
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
