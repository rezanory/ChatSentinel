const WATCHDOG = 'http://127.0.0.1:4317';
const CLIENT_HEADERS = Object.freeze({ 'x-chatsentinel-client': 'extension' });
const auto = document.querySelector('#auto');
const health = document.querySelector('#health');
const sessions = document.querySelector('#sessions');
const refresh = document.querySelector('#refresh');
const chatId = document.querySelector('#chatId');
const projectPath = document.querySelector('#projectPath');
const operationClass = document.querySelector('#operationClass');
const saveProject = document.querySelector('#saveProject');
const saveStatus = document.querySelector('#saveStatus');
let currentConversationId = null;

init();
refresh.addEventListener('click', load);
auto.addEventListener('change', async () => {
  await chrome.storage.local.set({ autoRecoveryEnabled: auto.checked });
  renderHealth();
});
saveProject.addEventListener('click', saveCurrentProject);

async function init() {
  const stored = await chrome.storage.local.get(['autoRecoveryEnabled']);
  auto.checked = Boolean(stored.autoRecoveryEnabled);
  await loadCurrentConversation();
  await load();
}

async function loadCurrentConversation() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const match = tab?.url?.match(/chatgpt\.com\/c\/([^/?#]+)/);
  currentConversationId = match?.[1] || null;
  chatId.textContent = currentConversationId
    ? `Conversation: ${currentConversationId}`
    : 'Open a saved ChatGPT conversation to register a project.';
  saveProject.disabled = !currentConversationId;
  if (!currentConversationId) return;

  const projectKey = `projectPath:${currentConversationId}`;
  const operationKey = `operationClass:${currentConversationId}`;
  const values = await chrome.storage.local.get([projectKey, operationKey]);
  projectPath.value = values[projectKey] || '';
  operationClass.value = values[operationKey] || '';
}

async function saveCurrentProject() {
  if (!currentConversationId) return;
  saveStatus.textContent = 'Saving…';
  const projectKey = `projectPath:${currentConversationId}`;
  const operationKey = `operationClass:${currentConversationId}`;
  await chrome.storage.local.set({
    [projectKey]: projectPath.value.trim(),
    [operationKey]: operationClass.value
  });

  try {
    const result = await apiJson('/conversation/register', {
      method: 'POST',
      body: {
        conversationId: currentConversationId,
        projectPath: projectPath.value.trim() || undefined,
        operationClass: operationClass.value || undefined
      }
    });
    if (!result.ok) throw new Error(result.error || result.reconciliation?.reason || 'registration-failed');
    saveStatus.textContent = result.reconciliation
      ? `Registered · ${shortSha(result.reconciliation.head)}`
      : 'Registered';
    saveStatus.className = 'ok';
    await load();
  } catch (error) {
    saveStatus.textContent = `Failed: ${error.message}`;
    saveStatus.className = 'bad';
  }
}

async function load() {
  try {
    const [h, s] = await Promise.all([
      apiJson('/health'),
      apiJson('/supervisor')
    ]);
    health.dataset.ok = h.ok ? '1' : '0';
    health.dataset.count = String(s.count || 0);
    health.dataset.version = h.version || '';
    renderHealth();
    renderSessions(s.sessions || []);
  } catch (error) {
    health.textContent = `Local watchdog offline: ${error.message}`;
    health.className = 'bad';
    sessions.replaceChildren();
  }
}

function renderHealth() {
  const online = health.dataset.ok === '1';
  const count = Number(health.dataset.count || 0);
  const version = health.dataset.version ? ` v${health.dataset.version}` : '';
  health.textContent = online
    ? `Watchdog${version} online · ${count} session(s) · auto recovery ${auto.checked ? 'ON' : 'OFF'}`
    : 'Local watchdog status unknown';
  health.className = online ? 'ok' : 'muted';
}

function renderSessions(rows) {
  sessions.replaceChildren();
  if (!rows.length) {
    const empty = document.createElement('p');
    empty.className = 'muted';
    empty.textContent = 'No observed ChatGPT sessions yet.';
    sessions.append(empty);
    return;
  }

  for (const row of rows) {
    const item = document.createElement('div');
    item.className = 'row';
    const action = row.decision?.action || 'UNKNOWN';
    const reason = row.decision?.reason || '';
    const risk = row.sideEffectRisk || 'unknown';
    const fresh = row.checkpointFresh ? 'fresh checkpoint' : 'checkpoint uncertain';
    item.innerHTML = `<div><strong>${escapeHtml(row.id)}</strong></div>` +
      `<div>${escapeHtml(row.state || 'UNKNOWN')} · <span class="decision">${escapeHtml(action)}</span></div>` +
      `<div class="muted">${escapeHtml(reason)}</div>` +
      `<div class="muted">risk=${escapeHtml(risk)} · ${escapeHtml(fresh)}</div>` +
      `<div class="muted">${escapeHtml(row.branch || '')} ${escapeHtml(shortSha(row.head))}</div>`;
    sessions.append(item);
  }
}

async function apiJson(route, options = {}) {
  const headers = { ...CLIENT_HEADERS };
  let body;
  if (options.body !== undefined) {
    headers['content-type'] = 'application/json';
    body = JSON.stringify(options.body);
  }
  const response = await fetch(`${WATCHDOG}${route}`, {
    method: options.method || 'GET',
    headers,
    body
  });
  const result = await response.json().catch(() => ({ ok: false, error: `http-${response.status}` }));
  if (!response.ok) throw new Error(result.error || `http-${response.status}`);
  return result;
}

function shortSha(value) { return value ? value.slice(0, 8) : ''; }
function escapeHtml(value='') {
  return String(value).replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
}
