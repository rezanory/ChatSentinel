const VERDICT_RE = /\bVERDICT\s*:\s*(CONTINUE_NEW_WORKER|REPLACE_WORKER|ACCEPT_COMPLETE|HOLD)\b/i;
const INCIDENT_RE = /\bINCIDENT\s*:\s*([a-z0-9_-]{3,120})\b/i;
export const DEFAULT_JUDGE_ROLLOVER = 6;

export function terminalCandidate(row = {}, lastCommand = null) {
  if (!row?.conversationId || row?.completion?.complete) return null;
  const session = row.session || {};
  if (String(session.state || '').toUpperCase() !== 'IDLE') return null;
  if (!session.lastAssistantText || Number(session.assistantSettledMs || 0) < 8000) return null;
  if (!lastCommand || lastCommand.status !== 'succeeded') return null;
  const fingerprint = String(session.lastAssistantFingerprint || '').trim();
  if (!fingerprint) return null;
  return {
    projectId: session.projectId,
    laneId: row.lane?.laneId,
    laneName: row.lane?.laneName,
    conversationId: row.conversationId,
    tabId: session.tabId,
    branch: row.lane?.branch,
    baselineSha: row.lane?.baselineSha,
    completionReason: row.completion?.reason || 'lane-incomplete',
    assistantFingerprint: fingerprint,
    assistantExcerpt: String(session.lastAssistantText || '').slice(-1800)
  };
}
export function parseJudgeVerdict(text) {
  const match = String(text || '').match(VERDICT_RE);
  return match ? match[1].toUpperCase() : '';
}

export function parseJudgeDecision(text) {
  const value = String(text || '');
  return {
    verdict: parseJudgeVerdict(value),
    incident: value.match(INCIDENT_RE)?.[1] || ''
  };
}

export function buildJudgePrompt(candidate = {}) {
  return [
    'CHATSENTINEL JUDGE. ADJUDICATION ONLY - DO NOT EXECUTE PROJECT WORK.',
    'A worker chat became idle after a response, but deterministic Git/workflow evidence says its lane is not complete.',
    `Lane: ${candidate.laneId || 'unknown'} (${candidate.laneName || 'unnamed'})`,
    `Branch: ${candidate.branch || 'unknown'}`,
    `Completion gate: ${candidate.completionReason || 'incomplete'}`,
    `Worker conversation: ${candidate.conversationId || 'unknown'}`,
    `Incident: ${candidate.assistantFingerprint || 'unknown'}`,
    'Worker final excerpt:',
    String(candidate.assistantExcerpt || '').slice(-1800),
    ''
  ].join('\n');
}
export function buildJudgeInstruction(candidate = {}) {
  return [
    buildJudgePrompt(candidate),
    'Decide only whether work must continue in another worker chat. Never modify files, run tools, push, merge, or perform the work yourself.',
    'The deterministic Git/workflow gate has final authority; ACCEPT_COMPLETE is advisory and cannot override an incomplete gate.',
    'Reply with exactly one first-line verdict:',
    'VERDICT: CONTINUE_NEW_WORKER | VERDICT: REPLACE_WORKER | VERDICT: ACCEPT_COMPLETE | VERDICT: HOLD',
    `Second line: INCIDENT: ${candidate.assistantFingerprint || 'unknown'}`,
    'Then give at most 5 short lines explaining what the next worker must verify.'
  ].join('\n');
}

export function judgeNeedsRollover(commands = [], maxAdjudications = DEFAULT_JUDGE_ROLLOVER, sinceAt = '') {
  const floor = Date.parse(sinceAt || '') || 0;
  const completed = commands.filter(command =>
    command?.status === 'succeeded' &&
    (Date.parse(command?.updatedAt || command?.createdAt || '') || 0) >= floor &&
    String(command?.payload?.role || '').toLowerCase() === 'judge' &&
    ['SEND_PROMPT', 'CREATE_LANE_CHAT'].includes(command?.type)
  ).length;
  return completed >= Math.max(2, Number(maxAdjudications || DEFAULT_JUDGE_ROLLOVER));
}
export function judgeChatForProject(configs = {}, sessions = {}, projectId) {
  const rows = Object.entries(configs)
    .filter(([, config]) => config?.projectId === projectId && String(config?.role || '').toLowerCase() === 'judge')
    .map(([conversationId, config]) => ({
      conversationId,
      config,
      session: sessions?.[conversationId] || {}
    }))
    .sort((a, b) =>
      Date.parse(b.session?.updatedAt || b.config?.attachedAt || 0) -
      Date.parse(a.session?.updatedAt || a.config?.attachedAt || 0)
    );
  return rows[0] || null;
}
