import { enqueueCommand } from '../../command-queue.js';
import { inspectLaneBranch } from './git-adapter.js';
import {
  detectLaneCompletion,
  decideLaneAction,
  decideProjectAction,
  OrchestratorAction
} from './decision.js';
import {
  normalizeWorkflow,
  resolveWorkflow,
  selectCurrentStage,
  stageCompletion,
  evaluateWorkflow
} from '../workflow-continuation/controller.js';

export async function configureOrchestration(store, projectId, plan) {
  const project = store.getProject(projectId);
  if (!project) return { ok: false, error: 'project-not-found' };
  const repoPath = String(plan?.repoPath || project.projectPath || '').trim();
  const workflowConfig = normalizeWorkflow(plan?.workflow || {});
  const workflow = workflowConfig.enabled
    ? await resolveWorkflow({ repoPath, workflow: workflowConfig })
    : workflowConfig;
  if (workflowConfig.enabled && !workflow.valid) {
    return { ok: false, error: workflow.error || 'workflow-invalid' };
  }
  const stage = workflowConfig.enabled ? selectCurrentStage(workflow) : null;
  const directLanes = Array.isArray(plan?.lanes)
    ? plan.lanes.map(normalizeLane).filter(Boolean)
    : [];
  const lanes = stage?.lanes?.length
    ? stage.lanes.map(normalizeLane).filter(Boolean)
    : directLanes;
  if (!lanes.length) return { ok: false, error: 'orchestrator-lanes-required' };

  const orchestration = {
    enabled: plan.enabled !== false,
    repoPath,
    integrationLane: stage?.integrationLane
      ? normalizeLane(stage.integrationLane)
      : (plan.integrationLane ? normalizeLane(plan.integrationLane) : null),
    lanes,
    workflow: workflowConfig.enabled
      ? {
          ...workflowConfig,
          currentStageId: workflowConfig.currentStageId || stage?.stageId || '',
          completedStageIds: workflowConfig.completedStageIds || []
        }
      : null,
    updatedAt: new Date().toISOString()
  };
  await store.setProject(projectId, { ...project, orchestration, updatedAt: new Date().toISOString() });
  return { ok: true, orchestration };
}

export async function tickProjectOrchestration(store, projectId, { logger } = {}) {
  const project = store.getProject(projectId);
  const plan = project?.orchestration;
  if (!plan?.enabled) {
    return { ok: true, action: OrchestratorAction.WAIT, reason: 'orchestration-disabled' };
  }

  const workflow = plan.workflow?.enabled
    ? await resolveWorkflow(plan)
    : normalizeWorkflow({ enabled: false });
  if (workflow.enabled && !workflow.valid) {
    const reason = workflow.error || 'workflow-invalid';
    logger?.error?.('workflow-continuation-blocked', { projectId, reason });
    return {
      ok: true,
      projectId,
      action: OrchestratorAction.BLOCKED,
      reason,
      workflow: summarizeWorkflow(workflow)
    };
  }

  const stage = workflow.enabled ? selectCurrentStage(workflow) : null;
  if (workflow.enabled && !stage) {
    const workflowDecision = evaluateWorkflow(workflow, null, { complete: true });
    const projectDecision = {
      action: OrchestratorAction[workflowDecision.action] || workflowDecision.action,
      reason: workflowDecision.reason,
      ...workflowDecision
    };
    const emitted = await materializeDecision(
      store, project, plan, [], projectDecision,
      { workflow, stage: null, stageState: { complete: true }, workflowDecision }
    );
    logger?.info?.('orchestrator-tick', {
      projectId, action: projectDecision.action, reason: projectDecision.reason,
      emitted: emitted?.command?.commandId
    });
    return {
      ok: true, projectId, action: projectDecision.action, reason: projectDecision.reason,
      lanes: [], command: emitted?.command || null,
      commands: emitted?.commands || (emitted?.command ? [emitted.command] : []),
      workflow: { ...summarizeWorkflow(workflow), stageId: null, stageState: { complete: true }, transition: emitted?.workflowTransition || null }
    };
  }
  const effectivePlan = stage
    ? { ...plan, lanes: stage.lanes || [], integrationLane: stage.integrationLane || null }
    : plan;
  const rows = [];
  for (const lane of effectivePlan.lanes || []) {
    rows.push(await inspectLaneRow(store, projectId, effectivePlan, lane));
  }

  let integrationRow = null;
  let projectDecision;
  let workflowDecision = null;
  let stageState = null;

  if (workflow.enabled) {
    const requiredRows = rows.filter(row => row?.lane?.required !== false);
    const implementationsComplete = requiredRows.length > 0 &&
      requiredRows.every(row => row?.completion?.complete === true);
    if (implementationsComplete && stage?.integrationLane) {
      integrationRow = await inspectLaneRow(store, projectId, effectivePlan, stage.integrationLane);
    }
    stageState = stageCompletion(stage, rows, integrationRow);
    if (stageState.complete) {
      workflowDecision = evaluateWorkflow(workflow, stage, stageState);
      projectDecision = {
        action: OrchestratorAction[workflowDecision.action] || workflowDecision.action,
        reason: workflowDecision.reason,
        ...workflowDecision
      };
    } else if (stageState.reason === 'stage-integration-incomplete' && integrationRow) {
      projectDecision = integrationRow.decision?.action !== OrchestratorAction.WAIT
        ? integrationRow.decision
        : { action: OrchestratorAction.WAIT, reason: 'stage-integration-active' };
    } else {
      projectDecision = decideProjectAction(rows);
    }
  } else {
    projectDecision = decideProjectAction(rows);
  }

  const allRows = integrationRow ? [...rows, integrationRow] : rows;
  const emitted = await materializeDecision(
    store,
    project,
    effectivePlan,
    allRows,
    projectDecision,
    { workflow, stage, stageState, workflowDecision }
  );
  logger?.info?.('orchestrator-tick', {
    projectId,
    action: projectDecision.action,
    reason: projectDecision.reason,
    stageId: stage?.stageId,
    emitted: emitted?.command?.commandId,
    emittedCount: emitted?.commands?.length || (emitted?.command ? 1 : 0)
  });
  return {
    ok: true,
    projectId,
    action: projectDecision.action,
    reason: projectDecision.reason,
    lanes: allRows.map(summarize),
    command: emitted?.command || null,
    commands: emitted?.commands || (emitted?.command ? [emitted.command] : []),
    workflow: workflow.enabled
      ? { ...summarizeWorkflow(workflow), stageId: stage?.stageId, stageState, transition: emitted?.workflowTransition || null }
      : null
  };
}

async function inspectLaneRow(store, projectId, plan, lane) {
  const configEntry = Object.entries(store.configs)
    .find(([, cfg]) => cfg?.projectId === projectId && cfg?.laneId === lane.laneId);
  const conversationId = configEntry?.[0];
  const session = conversationId
    ? { ...store.getSession(conversationId), conversationId }
    : {};
  const git = await inspectLaneBranch({
    repoPath: plan.repoPath,
    worktreePath: lane.worktreePath,
    branch: lane.branch,
    baselineSha: lane.baselineSha
  });
  const completion = detectLaneCompletion({ lane, session, git });
  const laneCommands = Object.values(store.commands)
    .filter(cmd => cmd?.payload?.projectId === projectId && cmd?.payload?.laneId === lane.laneId)
    .sort((a, b) => Date.parse(b.updatedAt || b.createdAt || 0) - Date.parse(a.updatedAt || a.createdAt || 0));
  const activeCommand = laneCommands.find(cmd => ['pending', 'running'].includes(cmd.status));
  const lastCommand = laneCommands[0] || null;
  const history = deriveLaneCommandHistory(laneCommands, { projectId, laneId: lane.laneId });
  const effectiveLane = { ...lane, ...history };
  const decision = decideLaneAction({
    lane: effectiveLane,
    session,
    completion,
    activeCommand,
    lastCommand
  });
  return { lane: effectiveLane, conversationId, session, git, completion, decision };
}

async function materializeDecision(store, project, plan, rows, decision, context = {}) {
  if ([OrchestratorAction.WAIT, OrchestratorAction.BLOCKED].includes(decision.action)) return null;
  if (decision.action === OrchestratorAction.COMPLETE) {
    return completeWorkflow(store, project, plan, context.workflow, context.stage, decision);
  }
  if (decision.action === OrchestratorAction.ADVANCE) {
    return advanceWorkflow(store, project, plan, context.workflow, decision);
  }
  if (decision.action === OrchestratorAction.REPLAN) {
    return replanWorkflow(store, project, context.workflow, context.stage, decision);
  }
  if (decision.action === OrchestratorAction.INTEGRATE) {
    const lane = plan.integrationLane;
    if (!lane) return null;
    return enqueueCommand(store, {
      type: 'CREATE_LANE_CHAT',
      idempotencyKey: `orchestrator:${project.projectId}:integrate:${completionKey(rows)}`,
      payload: {
        projectId: project.projectId,
        prompt: lane.prompt,
        laneId: lane.laneId,
        laneName: lane.laneName,
        branch: lane.branch,
        role: lane.role
      }
    });
  }
  const row = rows.find(item => item.decision.action === decision.action);
  if (!row) return null;
  const lane = row.lane;
  const common = {
    projectId: project.projectId,
    laneId: lane.laneId,
    laneName: lane.laneName,
    branch: lane.branch,
    role: lane.role
  };
  if (decision.action === OrchestratorAction.NEXT) {
    return enqueueCommand(store, {
      type: 'CREATE_LANE_CHAT',
      idempotencyKey: laneCreateIdempotencyKey(project.projectId, lane),
      payload: { ...common, prompt: lane.prompt }
    });
  }
  if (decision.action === OrchestratorAction.REPLACE) {
    return enqueueCommand(store, {
      type: 'REPLACE_CHAT',
      idempotencyKey: `orchestrator:${project.projectId}:${lane.laneId}:replace:${row.session?.updatedAt || 'none'}`,
      payload: {
        ...common,
        conversationId: row.conversationId,
        prompt: lane.replacePrompt || lane.prompt,
        closeOld: true
      }
    });
  }
  if (decision.action === OrchestratorAction.FIX) {
    const type = row.session?.decision?.action === 'RELOAD_AND_RECHECK'
      ? 'RELOAD_CHAT'
      : 'SEND_PROMPT';
    return enqueueCommand(store, {
      type,
      idempotencyKey: `orchestrator:${project.projectId}:${lane.laneId}:fix:${row.session?.updatedAt || 'none'}`,
      payload: type === 'RELOAD_CHAT'
        ? { ...common, conversationId: row.conversationId }
        : {
            ...common,
            conversationId: row.conversationId,
            prompt: lane.fixPrompt ||
              'Continue from the latest canonical handoff. Reconcile GitHub/local first, fix-forward all in-scope failures, run full suites without fail-fast, push, and hand off.'
          }
    });
  }
  return null;
}

export async function advanceWorkflow(store, project, plan, workflow, decision) {
  const nextStage = workflow.stages.find(stage => stage.stageId === decision.nextStageId);
  if (!nextStage) return null;
  const workflowState = {
    ...(plan.workflow || {}),
    enabled: true,
    currentStageId: nextStage.stageId,
    completedStageIds: decision.completedStageIds || workflow.completedStageIds || [],
    completedAt: null
  };
  const nextPlan = {
    ...plan,
    workflow: workflowState,
    lanes: nextStage.lanes || [],
    integrationLane: nextStage.integrationLane || null,
    updatedAt: new Date().toISOString()
  };
  await store.setProject(project.projectId, {
    ...project,
    orchestration: nextPlan,
    updatedAt: new Date().toISOString()
  });

  const commands = [];
  const candidates = (nextStage.lanes || [])
    .filter(lane => lane.required !== false)
    .slice(0, workflow.maxParallelLanes || 2);
  for (const lane of candidates) {
    const emitted = await enqueueCommand(store, {
      type: 'CREATE_LANE_CHAT',
      idempotencyKey: workflowLaneCreateKey(project.projectId, nextStage.stageId, lane),
      payload: {
        projectId: project.projectId,
        prompt: lane.prompt,
        laneId: lane.laneId,
        laneName: lane.laneName,
        branch: lane.branch,
        role: lane.role
      }
    });
    if (emitted?.command) commands.push(emitted.command);
  }
  return {
    command: commands[0] || null,
    commands,
    workflowTransition: {
      action: 'ADVANCE',
      fromStageId: workflow.currentStageId,
      toStageId: nextStage.stageId,
      completedStageIds: workflowState.completedStageIds
    }
  };
}

export async function completeWorkflow(store, project, plan, workflow, stage, decision) {
  const completedAt = new Date().toISOString();
  const completedStageIds = decision.completedStageIds || workflow.completedStageIds || [];
  const workflowState = {
    ...(plan.workflow || {}),
    enabled: true,
    currentStageId: stage?.stageId || workflow.currentStageId || '',
    completedStageIds,
    completedAt
  };
  await store.setProject(project.projectId, {
    ...project,
    orchestration: { ...plan, workflow: workflowState, updatedAt: completedAt },
    updatedAt: completedAt
  });
  return {
    command: null,
    commands: [],
    workflowTransition: {
      action: 'COMPLETE',
      stageId: stage?.stageId,
      completedAt,
      completedStageIds
    }
  };
}

export async function replanWorkflow(store, project, workflow, stage, decision) {
  const planner = workflow.plannerLane;
  if (!planner) return null;
  const completed = decision.completedStageIds || workflow.completedStageIds || [];
  const prompt = planner.prompt || buildWorkflowReplanPrompt(workflow, stage, completed);
  const emitted = await enqueueCommand(store, {
    type: 'CREATE_LANE_CHAT',
    idempotencyKey: `workflow-replan:${project.projectId}:${stage?.stageId || 'none'}:${completed.join(',') || 'none'}`,
    payload: {
      projectId: project.projectId,
      prompt,
      laneId: planner.laneId,
      laneName: planner.laneName || 'Workflow Continuation Review',
      branch: planner.branch,
      role: planner.role || 'governance'
    }
  });
  return {
    ...emitted,
    commands: emitted?.command ? [emitted.command] : [],
    workflowTransition: {
      action: 'REPLAN',
      stageId: stage?.stageId,
      reason: decision.reason,
      completedStageIds: completed
    }
  };
}

function buildWorkflowReplanPrompt(workflow, stage, completed) {
  return [
    'CHATSENTINEL WORKFLOW CONTINUATION REVIEW.',
    `Project goal: ${workflow.goal || workflow.goalId || 'unspecified'}`,
    `Terminal stage: ${workflow.terminalStageId || 'unspecified'}`,
    `Completed stages: ${completed.join(', ') || 'none'}`,
    `Current/last stage: ${stage?.stageId || 'none'}`,
    `Workflow source: ${workflow.sourcePath || 'inline workflow'}`,
    'Reconcile the canonical roadmap, latest non-superseded handoffs and actual Git state.',
    'Do not declare the project complete unless the terminal completion contract is satisfied.',
    'Materialize the next missing stage(s) and lane contracts in the workflow source, preserving dependency order and safe parallelism.',
    'Collect all gaps/failures, fix-forward only governance/workflow materialization issues, validate the manifest, push the exact green workflow update and hand off.'
  ].join('\n');
}

export function deriveLaneCommandHistory(laneCommands = [], { projectId, laneId } = {}) {
  const fixPrefix = `orchestrator:${projectId}:${laneId}:fix:`;
  const fixAttempts = laneCommands.filter(cmd =>
    String(cmd?.idempotencyKey || '').startsWith(fixPrefix) &&
    ['succeeded', 'failed'].includes(cmd?.status)
  ).length;
  const createGeneration = laneCommands.filter(cmd =>
    cmd?.type === 'CREATE_LANE_CHAT' && cmd?.status === 'succeeded'
  ).length;
  return { fixAttempts, createGeneration };
}

export function laneCreateIdempotencyKey(projectId, lane = {}) {
  const generation = Math.max(0, Number(lane.createGeneration || 0));
  return `orchestrator:${projectId}:${lane.laneId}:create:${generation}`;
}

export function workflowLaneCreateKey(projectId, stageId, lane = {}) {
  return `workflow:${projectId}:${stageId}:${lane.laneId}:create`;
}

function normalizeLane(lane) {
  if (!lane || !String(lane.laneId || '').trim()) return null;
  return {
    ...lane,
    laneId: String(lane.laneId).trim(),
    laneName: String(lane.laneName || lane.laneId).trim(),
    branch: String(lane.branch || '').trim(),
    baselineSha: String(lane.baselineSha || '').trim(),
    worktreePath: String(lane.worktreePath || '').trim(),
    prompt: String(lane.prompt || '').trim(),
    fixPrompt: String(lane.fixPrompt || '').trim(),
    required: lane.required !== false
  };
}

function completionKey(rows) {
  return rows.map(row => `${row.lane.laneId}:${row.git.remoteHead || 'none'}`).join('|');
}

function summarize(row) {
  return {
    laneId: row.lane.laneId,
    conversationId: row.conversationId,
    branch: row.lane.branch,
    remoteHead: row.git.remoteHead,
    complete: row.completion.complete,
    completionReason: row.completion.reason,
    action: row.decision.action,
    reason: row.decision.reason
  };
}

function summarizeWorkflow(workflow = {}) {
  return {
    enabled: Boolean(workflow.enabled),
    valid: Boolean(workflow.valid),
    goal: workflow.goal,
    goalId: workflow.goalId,
    terminalStageId: workflow.terminalStageId,
    currentStageId: workflow.currentStageId,
    completedStageIds: workflow.completedStageIds || [],
    sourcePath: workflow.sourcePath,
    sourceResolved: workflow.sourceResolved,
    error: workflow.error
  };
}
