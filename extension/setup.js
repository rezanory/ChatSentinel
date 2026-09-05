const BASE = 'http://127.0.0.1:4317';
const headers = { 'x-chatsentinel-client': 'extension' };
let platformInfo = { os: 'unknown', arch: 'unknown' };

document.getElementById('refresh').addEventListener('click', refresh);
document.getElementById('copyBootstrap').addEventListener('click', copyBootstrap);

chrome.runtime.getPlatformInfo(info => {
  platformInfo = info || platformInfo;
  renderDevice();
  refresh();
});

async function refresh() {
  renderDevice();
  const plan = await request('/setup/plan?service=1');
  if (!plan?.ok) {
    document.getElementById('version').textContent = 'Watchdog offline';
    document.getElementById('version').className = 'warn';
    renderOffline();
    return;
  }
  const report = plan.report || {};
  const watchdog = report.watchdog || {};
  document.getElementById('version').textContent = watchdog.version ? `v${watchdog.version}` : 'online';
  document.getElementById('version').className = 'ok';
  renderPrerequisites(report.prerequisites || {});
  setBootstrap(plan.bootstrapHint || bootstrapFor(platformInfo.os));
}

function renderDevice() {
  document.getElementById('device').textContent = `${platformInfo.os || 'unknown'} / ${platformInfo.arch || 'unknown'}`;
  const command = bootstrapFor(platformInfo.os);
  if (!document.getElementById('bootstrapCommand').textContent) setBootstrap(command);
}
function renderPrerequisites(prerequisites) {
  const labels = { node: 'Node.js', git: 'Git', chrome: 'Chrome', gh: 'GitHub CLI', runner: 'GitHub Runner', remoteBridge: 'Remote command bridge' };
  const html = Object.entries(labels).map(([id, label]) => {
    const row = prerequisites[id] || {};
    const installed = Boolean(row.installed);
    const detail = row.version ? ` ${escapeHtml(row.version)}` : row.root ? ` ${escapeHtml(row.root)}` : '';
    return `<div class="item"><strong class="${installed ? 'ok' : 'warn'}">${installed ? '✓' : '○'} ${label}</strong><div>${detail || (installed ? 'Detected' : 'Not detected')}</div></div>`;
  }).join('');
  document.getElementById('prerequisites').innerHTML = `<div class="grid">${html}</div>`;
  document.getElementById('bootstrapHelp').textContent = 'Use the platform bootstrap if anything required is missing, then refresh this page.';
}

function renderOffline() {
  document.getElementById('prerequisites').innerHTML = '<div class="warn">Local Watchdog is not reachable yet. Run the bootstrap from the ChatSentinel repository.</div>';
  document.getElementById('bootstrapHelp').textContent = 'First-stage bootstrap installs prerequisites; it does not require the Watchdog to already be running.';
  setBootstrap(bootstrapFor(platformInfo.os));
}

function setBootstrap(value) {
  document.getElementById('bootstrapCommand').textContent = value || '';
}

function bootstrapFor(os) {
  if (os === 'mac') return 'bash scripts/bootstrap-macos.sh --apply --service';
  if (os === 'win') return 'powershell -ExecutionPolicy Bypass -File scripts\\bootstrap-windows.ps1 -Apply -Service';
  return 'node scripts/setup-cli.mjs plan --service';
}
async function copyBootstrap() {
  const value = document.getElementById('bootstrapCommand').textContent || '';
  if (!value) return;
  try { await navigator.clipboard.writeText(value); }
  catch {}
}

async function request(route) {
  try {
    const response = await fetch(`${BASE}${route}`, { headers });
    if (!response.ok) return { ok: false, status: response.status };
    return await response.json();
  } catch {
    return { ok: false, offline: true };
  }
}

function escapeHtml(value) {
  return String(value || '').replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[char]));
}
