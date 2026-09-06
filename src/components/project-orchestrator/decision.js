export const OrchestratorAction = Object.freeze({
  WAIT: 'WAIT',
  NEXT: 'NEXT',
  FIX: 'FIX',
  REPLACE: 'REPLACE',
  INTEGRATE: 'INTEGRATE',
  ADVANCE: 'ADVANCE',
  REPLAN: 'REPLAN',
  COMPLETE: 'COMPLETE',
  BLOCKED: 'BLOCKED'
});

export function detectLaneCompletion({ lane = {}, session = {}, git = {} } = {}) {
  if (lane.required === false) return { complete: true, reason: 'optional-lane' };
  if (!lane.branch || !lane.baselineSha) return { complete: false, reason: 'lane-contract-incomplete' };
  if (!git.remoteHead) return { complete: false, reason: 'remote-head-missing' };
  if (git.remoteHead === lane.baselineSha) return { complete: false, reason: 'branch-not-advanced' };
  if (git.clean === false) return { complete: false, reason: 'worktree-dirty' };
  if (git.localHead && git.localHead !== git.remoteHead) return { complete: false, reason: 'local-remote-mismatch' };
  if (session.state && session.state !== 'IDLE') return { complete: false, reason: 'chat-not-idle' };
  if (session.decision?.action === 'ESCALATE') return { complete: false, reason: 'chat-escalated' };
  return { complete: true, reason: 'remote-advanced-clean-idle', head: git.remoteHead };
}

export function decideLaneAction({ lane = {}, session = {}, completion = {}, activeCommand = null, lastCommand = null } = {}) {
  if (completion.complete) return { action: OrchestratorAction.WAIT, reason: 'lane-complete' };
  if (completion.reason === 'lane-contract-incomplete') return { action: OrchestratorAction.BLOCKED, reason: 'lane-contract-incomplete' };
  if (activeCommand && ['pending', 'running'].includes(activeCommand.status)) {
    return { action: OrchestratorAction.WAIT, reason: 'command-in-flight' };
  }
  if (!session || Object.keys(session).length === 0) {
    return { action: OrchestratorAction.NEXT, reason: 'lane-chat-missing' };
  }
  if (session.conversationDead) {
    return replaceOrBlock(lane, 'conversation-dead');
  }
  const recovery = session.decision?.action;
  if (recovery === 'CONTINUE_NEW_CHAT' || recovery === 'ESCALATE') {
    return replaceOrBlock(lane, `recovery-${String(recovery).toLowerCase()}`);
  }
  if (['SAFE_RETRY', 'CONTINUE_SAME_CHAT', 'RELOAD_AND_RECHECK'].includes(recovery)) {
    return fixOrReplace(lane, `recovery-${recovery.toLowerCase()}`);
  }
  if (session.state === 'IDLE' &&
      ['branch-not-advanced', 'continuation-pending'].includes(completion.reason) &&
      lastCommand?.status === 'succeeded') {
    const commandAtMs = Date.parse(lastCommand.completedAt || lastCommand.updatedAt || '');
    const idleKickAfterMs = Number(lane.idleKickAfterMs || 120000);
    if (Number.isFinite(commandAtMs) && Date.now() - commandAtMs >= idleKickAfterMs) {
      return fixOrReplace(lane, 'idle-no-branch-progress');
    }
  }
  const updatedAtMs = Date.parse(session.updatedAt || '');
  const silenceAgeMs = Number.isFinite(updatedAtMs) ? Math.max(0, Date.now() - updatedAtMs) : 0;
  const effectiveProgressAgeMs = Math.max(Number(session.progressAgeMs || 0), silenceAgeMs);
  if (effectiveProgressAgeMs >= Number(lane.stallAfterMs || 300000)) {
    return fixOrReplace(lane, 'lane-stalled');
  }
  return { action: OrchestratorAction.WAIT, reason: completion.reason || 'lane-active' };
}

export function decideProjectAction(lanes = []) {
  const required = lanes.filter(row => row.lane?.required !== false);
  if (required.length && required.every(row => row.completion?.complete)) {
    return { action: OrchestratorAction.INTEGRATE, reason: 'all-required-lanes-complete' };
  }
  const actionable = required.filter(row => row.decision?.action && row.decision.action !== OrchestratorAction.WAIT);
  const runnable = actionable.find(row => row.decision.action !== OrchestratorAction.BLOCKED);
  return runnable?.decision || actionable[0]?.decision || { action: OrchestratorAction.WAIT, reason: 'no-project-action' };
}

function fixOrReplace(lane, reason) {
  const fixes = Number(lane.fixAttempts || 0);
  if (fixes < Number(lane.maxFixAttempts || 2)) {
    return { action: OrchestratorAction.FIX, reason };
  }
  return replaceOrBlock(lane, 'fix-budget-exhausted');
}

function replaceOrBlock(lane, reason) {
  const replacements = Number(lane.replaceAttempts || 0);
  if (replacements >= Number(lane.maxReplaceAttempts || 2)) {
    return { action: OrchestratorAction.BLOCKED, reason: 'replace-budget-exhausted' };
  }
  return { action: OrchestratorAction.REPLACE, reason };
}