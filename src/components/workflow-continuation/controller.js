import fs from 'node:fs/promises';
import path from 'node:path';

export const DEFAULT_WORKFLOW_SOURCE = 'control/chatsentinel-workflow.json';

export async function resolveWorkflow(orchestration = {}) {
  const repoPath = String(orchestration.repoPath || '').trim();
  const configured = normalizeWorkflow(orchestration.workflow || {});
  if (!configured.enabled) return configured;
  if (!configured.sourcePath) return configured;
  if (!repoPath) return { ...configured, valid: false, error: 'workflow-repo-path-required' };

  try {
    const file = safeWorkflowPath(repoPath, configured.sourcePath);
    const parsed = JSON.parse(await fs.readFile(file, 'utf8'));
    const manifest = normalizeWorkflow(parsed);
    return mergeWorkflowState(manifest, configured, file);
  } catch (error) {
    return {
      ...configured,
      valid: false,
      error: String(error?.message || error),
      sourceResolved: false
    };
  }
}

export function normalizeWorkflow(input = {}) {
  const enabled = input.enabled === true;
  const stages = Array.isArray(input.stages)
    ? input.stages.map(normalizeStage).filter(Boolean)
    : [];
  const stageBaselines = normalizeStageBaselines(input.stageBaselines);
  const boundStages = stages.map(stage => bindStageBaseline(stage, stageBaselines[stage.stageId]));
  const completedStageIds = [...new Set(
    (Array.isArray(input.completedStageIds) ? input.completedStageIds : [])
      .map(value => String(value || '').trim())
      .filter(Boolean)
  )];
  const terminalStageId = String(
    input.terminalStageId || input.goal?.terminalStageId || ''
  ).trim();
  const currentStageId = String(input.currentStageId || '').trim();
  return {
    enabled,
    valid: !enabled || boundStages.length > 0 || Boolean(input.sourcePath),
    goal: String(input.goal?.label || input.goal || '').trim(),
    goalId: String(input.goal?.id || input.goalId || '').trim(),
    terminalStageId,
    sourcePath: input.sourcePath === false ? '' : String(input.sourcePath || '').trim(),
    currentStageId,
    completedStageIds,
    completedAt: String(input.completedAt || '').trim(),
    plannerLane: normalizeLane(input.plannerLane),
    profileId: String(input.profileId || '').trim(),
    canonicalSources: Array.isArray(input.canonicalSources) ? input.canonicalSources : [],
    canonicalTotals: input.canonicalTotals && typeof input.canonicalTotals === 'object' ? input.canonicalTotals : null,
    derivedFromCanonicalRoadmap: input.derivedFromCanonicalRoadmap === true,
    maxParallelLanes: input.maxParallelLanes === undefined || input.maxParallelLanes === null
      ? null
      : Math.max(1, Math.min(8, Number(input.maxParallelLanes || 2))),
    stageBaselines,
    stages: boundStages
  };
}

export function selectCurrentStage(workflow = {}) {
  const stages = workflow.stages || [];
  if (!stages.length) return null;
  const completed = new Set(workflow.completedStageIds || []);
  if (workflow.currentStageId) {
    const explicit = stages.find(stage => stage.stageId === workflow.currentStageId);
    if (explicit && !completed.has(explicit.stageId)) return explicit;
  }
  return stages.find(stage => !completed.has(stage.stageId)) || null;
}

export function stageCompletion(stage, rows = [], integrationRow = null) {
  if (!stage) return { complete: false, reason: 'workflow-stage-missing' };
  const requiredRows = rows.filter(row => row?.lane?.required !== false);
  const implementationComplete = requiredRows.length > 0 &&
    requiredRows.every(row => row?.completion?.complete === true);
  if (!implementationComplete) {
    return { complete: false, reason: 'stage-lanes-incomplete', implementationComplete: false };
  }
  if (stage.integrationLane) {
    if (!integrationRow?.completion?.complete) {
      return { complete: false, reason: 'stage-integration-incomplete', implementationComplete: true };
    }
  }
  return { complete: true, reason: 'workflow-stage-complete', implementationComplete: true };
}

export function evaluateWorkflow(workflow, stage, completion) {
  if (!workflow?.enabled) return { action: 'DISABLED', reason: 'workflow-disabled' };
  if (!workflow.valid) return { action: 'BLOCKED', reason: 'workflow-invalid' };
  if (!stage) {
    if (workflow.terminalStageId && (workflow.completedStageIds || []).includes(workflow.terminalStageId)) {
      return { action: 'COMPLETE', reason: 'workflow-terminal-stage-complete' };
    }
    return { action: workflow.plannerLane ? 'REPLAN' : 'BLOCKED', reason: 'workflow-no-current-stage' };
  }
  if (!completion?.complete) return { action: 'CONTINUE', reason: completion?.reason || 'workflow-stage-active' };

  const completed = new Set(workflow.completedStageIds || []);
  completed.add(stage.stageId);
  const stages = workflow.stages || [];
  const currentIndex = stages.findIndex(row => row.stageId === stage.stageId);
  const next = stages.slice(currentIndex + 1).find(row => !completed.has(row.stageId));
  if (next) {
    return { action: 'ADVANCE', reason: 'workflow-next-stage', nextStageId: next.stageId, completedStageIds: [...completed] };
  }
  if (workflow.terminalStageId && stage.stageId === workflow.terminalStageId) {
    return { action: 'COMPLETE', reason: 'workflow-terminal-stage-complete', completedStageIds: [...completed] };
  }
  return {
    action: workflow.plannerLane ? 'REPLAN' : 'BLOCKED',
    reason: 'workflow-goal-incomplete-no-next-stage',
    completedStageIds: [...completed]
  };
}

export function applyWorkflowState(workflow, update = {}) {
  return normalizeWorkflow({
    ...workflow,
    currentStageId: update.currentStageId ?? workflow.currentStageId,
    completedStageIds: update.completedStageIds ?? workflow.completedStageIds,
    stageBaselines: update.stageBaselines ?? workflow.stageBaselines
  });
}

function mergeWorkflowState(manifest, configured, file) {
  const state = {
    currentStageId: configured.currentStageId || manifest.currentStageId,
    completedStageIds: configured.completedStageIds?.length
      ? configured.completedStageIds
      : manifest.completedStageIds,
    plannerLane: configured.plannerLane || manifest.plannerLane,
    maxParallelLanes: configured.maxParallelLanes || manifest.maxParallelLanes || 2,
    completedAt: configured.completedAt || manifest.completedAt || '',
    stageBaselines: { ...(manifest.stageBaselines || {}), ...(configured.stageBaselines || {}) }
  };
  return {
    ...manifest,
    ...state,
    stages: manifest.stages.map(stage => bindStageBaseline(stage, state.stageBaselines[stage.stageId])),
    enabled: true,
    sourcePath: configured.sourcePath,
    sourceFile: file,
    sourceResolved: true,
    valid: manifest.valid && manifest.stages.length > 0
  };
}

function normalizeStageBaselines(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return {};
  return Object.fromEntries(Object.entries(input)
    .map(([stageId, value]) => [String(stageId || '').trim(), String(value || '').trim().toLowerCase()])
    .filter(([stageId, value]) => stageId && /^[0-9a-f]{40}$/.test(value)));
}

function bindStageBaseline(stage, baselineSha) {
  const baseline = String(baselineSha || '').trim().toLowerCase();
  if (!stage || !/^[0-9a-f]{40}$/.test(baseline)) return stage;
  return {
    ...stage,
    baselineSha: baseline,
    lanes: (stage.lanes || []).map(lane => ({ ...lane, baselineSha: baseline })),
    integrationLane: stage.integrationLane ? { ...stage.integrationLane, baselineSha: baseline } : null
  };
}

function normalizeStage(stage) {
  const stageId = String(stage?.stageId || stage?.id || '').trim();
  if (!stageId) return null;
  const lanes = Array.isArray(stage.lanes) ? stage.lanes.map(normalizeLane).filter(Boolean) : [];
  return {
    ...stage,
    stageId,
    label: String(stage.label || stage.name || stageId).trim(),
    lanes,
    integrationLane: normalizeLane(stage.integrationLane),
    required: stage.required !== false
  };
}

function normalizeLane(lane) {
  const laneId = String(lane?.laneId || '').trim();
  if (!laneId) return null;
  return {
    ...lane,
    laneId,
    laneName: String(lane.laneName || laneId).trim(),
    branch: String(lane.branch || '').trim(),
    baselineSha: String(lane.baselineSha || '').trim(),
    worktreePath: String(lane.worktreePath || '').trim(),
    prompt: String(lane.prompt || '').trim(),
    fixPrompt: String(lane.fixPrompt || '').trim(),
    role: String(lane.role || 'implementation').trim(),
    required: lane.required !== false
  };
}

function safeWorkflowPath(repoPath, sourcePath) {
  const root = path.resolve(repoPath);
  const source = String(sourcePath || DEFAULT_WORKFLOW_SOURCE).trim() || DEFAULT_WORKFLOW_SOURCE;
  const resolved = path.resolve(root, source);
  const relative = path.relative(root, resolved);
  if (!relative || relative === '.') throw new Error('workflow-source-file-required');
  if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('workflow-source-outside-repo');
  return resolved;
}
