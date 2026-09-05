import { enqueueCommand } from '../../command-queue.js';
import { inspectLaneBranch } from './git-adapter.js';
import { detectLaneCompletion, decideLaneAction, decideProjectAction, OrchestratorAction } from './decision.js';

export async function configureOrchestration(store, projectId, plan) {
  const project = store.getProject(projectId);
  if (!project) return { ok: false, error: 'project-not-found' };
  const lanes = Array.isArray(plan?.lanes) ? plan.lanes.map(normalizeLane).filter(Boolean) : [];
  if (!lanes.length) return { ok: false, error: 'orchestrator-lanes-required' };
  const orchestration = {
    enabled: plan.enabled !== false,
    repoPath: String(plan.repoPath || project.projectPath || '').trim(),
    integrationLane: plan.integrationLane ? normalizeLane(plan.integrationLane) : null,
    lanes,
    updatedAt: new Date().toISOString()
  };
  await store.setProject(projectId, { ...project, orchestration, updatedAt: new Date().toISOString() });
  return { ok: true, orchestration };
}

export async function tickProjectOrchestration(store, projectId, { logger } = {}) {
  const project = store.getProject(projectId);
  const plan = project?.orchestration;
  if (!plan?.enabled) return { ok: true, action: OrchestratorAction.WAIT, reason: 'orchestration-disabled' };
  const rows = [];
  for (const lane of plan.lanes || []) {
    const configEntry = Object.entries(store.configs).find(([, cfg]) => cfg?.projectId === projectId && cfg?.laneId === lane.laneId);
    const conversationId = configEntry?.[0];
    const session = conversationId ? { ...store.getSession(conversationId), conversationId } : {};
    const git = await inspectLaneBranch({ repoPath: plan.repoPath, worktreePath: lane.worktreePath, branch: lane.branch, baselineSha: lane.baselineSha });
    const completion = detectLaneCompletion({ lane, session, git });
    const laneCommands = Object.values(store.commands)
      .filter(cmd => cmd?.payload?.projectId === projectId && cmd?.payload?.laneId === lane.laneId)
      .sort((a, b) => Date.parse(b.updatedAt || b.createdAt || 0) - Date.parse(a.updatedAt || a.createdAt || 0));
    const activeCommand = laneCommands.find(cmd => ['pending','running'].includes(cmd.status));
    const lastCommand = laneCommands[0] || null;
    const history = deriveLaneCommandHistory(laneCommands, { projectId, laneId: lane.laneId });
    const effectiveLane = { ...lane, ...history };
    const decision = decideLaneAction({ lane: effectiveLane, session, completion, activeCommand, lastCommand });
    rows.push({ lane: effectiveLane, conversationId, session, git, completion, decision });
  }
  const projectDecision = decideProjectAction(rows);
  const emitted = await materializeDecision(store, project, plan, rows, projectDecision);
  logger?.info?.('orchestrator-tick', { projectId, action: projectDecision.action, reason: projectDecision.reason, emitted: emitted?.command?.commandId });
  return { ok: true, projectId, action: projectDecision.action, reason: projectDecision.reason, lanes: rows.map(summarize), command: emitted?.command || null };
}
async function materializeDecision(store, project, plan, rows, decision) {
  if (decision.action === OrchestratorAction.WAIT) return null;
  if (decision.action === OrchestratorAction.INTEGRATE) {
    const lane = plan.integrationLane;
    if (!lane) return null;
    return enqueueCommand(store, {
      type: 'CREATE_LANE_CHAT',
      idempotencyKey: `orchestrator:${project.projectId}:integrate:${completionKey(rows)}`,
      payload: { projectId: project.projectId, prompt: lane.prompt, laneId: lane.laneId, laneName: lane.laneName, branch: lane.branch, role: lane.role }
    });
  }
  const row = rows.find(item => item.decision.action === decision.action);
  if (!row) return null;
  const lane = row.lane;
  const common = { projectId: project.projectId, laneId: lane.laneId, laneName: lane.laneName, branch: lane.branch, role: lane.role };
  if (decision.action === OrchestratorAction.NEXT) {
    return enqueueCommand(store, { type: 'CREATE_LANE_CHAT', idempotencyKey: laneCreateIdempotencyKey(project.projectId, lane), payload: { ...common, prompt: lane.prompt } });
  }
  if (decision.action === OrchestratorAction.REPLACE) {
    return enqueueCommand(store, { type: 'REPLACE_CHAT', idempotencyKey: `orchestrator:${project.projectId}:${lane.laneId}:replace:${row.session?.updatedAt || 'none'}`, payload: { ...common, conversationId: row.conversationId, prompt: lane.replacePrompt || lane.prompt, closeOld: true } });
  }
  if (decision.action === OrchestratorAction.FIX) {
    const type = row.session?.decision?.action === 'RELOAD_AND_RECHECK' ? 'RELOAD_CHAT' : 'SEND_PROMPT';
    return enqueueCommand(store, { type, idempotencyKey: `orchestrator:${project.projectId}:${lane.laneId}:fix:${row.session?.updatedAt || 'none'}`, payload: type === 'RELOAD_CHAT' ? { ...common, conversationId: row.conversationId } : { ...common, conversationId: row.conversationId, prompt: lane.fixPrompt || 'Continue from the latest canonical handoff. Reconcile GitHub/local first, fix-forward all in-scope failures, run full suites without fail-fast, push, and hand off.' } });
  }
  return null;
}

export function deriveLaneCommandHistory(laneCommands = [], { projectId, laneId } = {}) {
  const fixPrefix = `orchestrator:${projectId}:${laneId}:fix:`;
  const fixAttempts = laneCommands.filter(cmd => String(cmd?.idempotencyKey || '').startsWith(fixPrefix) && ['succeeded','failed'].includes(cmd?.status)).length;
  const createGeneration = laneCommands.filter(cmd => cmd?.type === 'CREATE_LANE_CHAT' && cmd?.status === 'succeeded').length;
  return { fixAttempts, createGeneration };
}

export function laneCreateIdempotencyKey(projectId, lane = {}) {
  const generation = Math.max(0, Number(lane.createGeneration || 0));
  return `orchestrator:${projectId}:${lane.laneId}:create:${generation}`;
}

function normalizeLane(lane) {
  if (!lane || !String(lane.laneId || '').trim()) return null;
  return { ...lane, laneId: String(lane.laneId).trim(), laneName: String(lane.laneName || lane.laneId).trim(), branch: String(lane.branch || '').trim(), baselineSha: String(lane.baselineSha || '').trim(), prompt: String(lane.prompt || '').trim(), required: lane.required !== false };
}
function completionKey(rows) { return rows.map(row => `${row.lane.laneId}:${row.git.remoteHead || 'none'}`).join('|'); }
function summarize(row) { return { laneId: row.lane.laneId, conversationId: row.conversationId, branch: row.lane.branch, remoteHead: row.git.remoteHead, complete: row.completion.complete, completionReason: row.completion.reason, action: row.decision.action, reason: row.decision.reason }; }
