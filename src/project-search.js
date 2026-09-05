const SEARCH_STATES = new Set(['', 'UNKNOWN', 'RUNNING', 'STALLED', 'INTERRUPTED', 'DEAD', 'COMPLETE']);

export function searchProjectChats(store, filters = {}) {
  const query = normalize(filters.query).toLowerCase();
  const projectId = normalize(filters.projectId);
  const state = normalize(filters.state).toUpperCase();
  const action = normalize(filters.action).toUpperCase();
  const risk = normalize(filters.risk).toLowerCase();
  const checkpointFresh = parseTriState(filters.checkpointFresh);
  if (!SEARCH_STATES.has(state)) return { ok: false, error: 'state-filter-invalid' };

  const rows = [];
  for (const [conversationId, config] of Object.entries(store.configs || {})) {
    const project = config?.projectId ? store.getProject(config.projectId) : null;
    if (projectId && project?.projectId !== projectId) continue;
    const session = store.getSession(conversationId) || {};
    const row = makeRow(conversationId, project, config, session);
    if (query && !row.searchText.includes(query)) continue;
    if (state && String(row.state).toUpperCase() !== state) continue;
    if (action && String(row.action).toUpperCase() !== action) continue;
    if (risk && String(row.sideEffectRisk).toLowerCase() !== risk) continue;
    if (checkpointFresh !== null && Boolean(row.checkpointFresh) !== checkpointFresh) continue;
    rows.push(row);
  }

  rows.sort(compareRows);
  return { ok: true, count: rows.length, results: rows.map(({ searchText, ...row }) => row) };
}
function makeRow(conversationId, project, config, session) {
  const row = {
    conversationId,
    projectId: project?.projectId || config?.projectId || null,
    projectName: project?.name || '',
    projectPath: project?.projectPath || config?.projectPath || '',
    title: config?.title || session?.title || '',
    url: config?.url || session?.url || '',
    tabId: config?.tabId ?? session?.tabId,
    operationClass: config?.operationClass || session?.operationClass || '',
    state: session?.state || 'UNKNOWN',
    action: session?.decision?.action || '',
    reason: session?.decision?.reason || '',
    sideEffectRisk: session?.sideEffectRisk || 'unknown',
    checkpointFresh: Boolean(session?.checkpointFresh),
    updatedAt: session?.updatedAt || ''
  };
  row.searchText = [row.conversationId, row.projectId, row.projectName, row.projectPath,
    row.title, row.url, row.operationClass, row.state, row.action, row.reason, row.sideEffectRisk]
    .map(value => String(value || '').toLowerCase()).join('\n');
  return row;
}

function compareRows(a, b) {
  const project = String(a.projectName).localeCompare(String(b.projectName));
  if (project) return project;
  const updated = Date.parse(b.updatedAt || 0) - Date.parse(a.updatedAt || 0);
  return updated || String(a.title || a.conversationId).localeCompare(String(b.title || b.conversationId));
}

function normalize(value) { return String(value ?? '').trim(); }
function parseTriState(value) {
  if (value === true || value === 'true' || value === '1') return true;
  if (value === false || value === 'false' || value === '0') return false;
  return null;
}
