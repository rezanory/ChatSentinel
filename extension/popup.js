const WATCHDOG = 'http://127.0.0.1:4317';
const auto = document.querySelector('#auto');
const health = document.querySelector('#health');
const sessions = document.querySelector('#sessions');
const refresh = document.querySelector('#refresh');

init();
refresh.addEventListener('click', load);
auto.addEventListener('change', async () => {
  await chrome.storage.local.set({ autoRecoveryEnabled: auto.checked });
  renderHealth();
});

async function init() {
  const stored = await chrome.storage.local.get(['autoRecoveryEnabled']);
  auto.checked = Boolean(stored.autoRecoveryEnabled);
  await load();
}

async function load() {
  try {
    const [h, s] = await Promise.all([
      fetch(`${WATCHDOG}/health`).then(r => r.json()),
      fetch(`${WATCHDOG}/supervisor`).then(r => r.json())
    ]);
    health.dataset.ok = h.ok ? '1' : '0';
    health.dataset.count = String(s.count || 0);
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
  health.textContent = online
    ? `Watchdog online · ${count} session(s) · auto recovery ${auto.checked ? 'ON' : 'OFF'}`
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
    item.innerHTML = `<div><strong>${escapeHtml(row.id)}</strong></div>` +
      `<div>${escapeHtml(row.state || 'UNKNOWN')} · <span class="decision">${escapeHtml(action)}</span></div>` +
      `<div class="muted">${escapeHtml(reason)}</div>` +
      `<div class="muted">${escapeHtml(row.branch || '')} ${escapeHtml(shortSha(row.head))}</div>`;
    sessions.append(item);
  }
}

function shortSha(value) { return value ? value.slice(0, 8) : ''; }
function escapeHtml(value='') {
  return String(value).replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
}
