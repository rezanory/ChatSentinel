import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  normalizeWorkflow,
  resolveWorkflow,
  selectCurrentStage,
  stageCompletion,
  evaluateWorkflow,
  applyWorkflowState
} from '../src/components/workflow-continuation/controller.js';
import { configureOrchestration, advanceWorkflow, completeWorkflow, replanWorkflow } from '../src/components/project-orchestrator/controller.js';

function laneRow(id, complete = true) {
  return {
    lane: { laneId: id, required: true },
    completion: { complete, reason: complete ? 'done' : 'pending' }
  };
}

test('workflow advances after the current stage but does not confuse stage completion with project completion', () => {
  const workflow = normalizeWorkflow({
    enabled: true,
    goal: { id: 'g', label: 'multi-stage workflow', terminalStageId: 'TERMINAL' },
    currentStageId: 'STAGE-A',
    stages: [
      { stageId: 'STAGE-A', lanes: [{ laneId: 'C1' }] },
      { stageId: 'STAGE-B', lanes: [{ laneId: 'C2' }] },
      { stageId: 'TERMINAL', lanes: [{ laneId: 'C3' }] }
    ]
  });
  const stage = selectCurrentStage(workflow);
  assert.equal(stage.stageId, 'STAGE-A');
  const completion = stageCompletion(stage, [laneRow('C1', true)]);
  assert.equal(completion.complete, true);
  const decision = evaluateWorkflow(workflow, stage, completion);
  assert.equal(decision.action, 'ADVANCE');
  assert.equal(decision.nextStageId, 'STAGE-B');
  assert.deepEqual(decision.completedStageIds, ['STAGE-A']);
});

test('workflow only completes when the configured terminal stage is complete', () => {
  const workflow = normalizeWorkflow({
    enabled: true,
    terminalStageId: 'TERMINAL',
    currentStageId: 'TERMINAL',
    completedStageIds: ['STAGE-A', 'STAGE-B', 'STAGE-C', 'STAGE-D'],
    stages: [{ stageId: 'TERMINAL', lanes: [{ laneId: 'FINAL' }] }]
  });
  const stage = selectCurrentStage(workflow);
  const decision = evaluateWorkflow(workflow, stage, stageCompletion(stage, [laneRow('FINAL', true)]));
  assert.equal(decision.action, 'COMPLETE');
  assert.equal(decision.reason, 'workflow-terminal-stage-complete');
});

test('workflow refuses false completion when the manifest ends before the goal', () => {
  const workflow = normalizeWorkflow({
    enabled: true,
    terminalStageId: 'TERMINAL',
    currentStageId: 'STAGE-B',
    plannerLane: { laneId: 'PLAN', prompt: 'Reconcile roadmap' },
    stages: [{ stageId: 'STAGE-B', lanes: [{ laneId: 'C2' }] }]
  });
  const stage = selectCurrentStage(workflow);
  const decision = evaluateWorkflow(workflow, stage, stageCompletion(stage, [laneRow('C2', true)]));
  assert.equal(decision.action, 'REPLAN');
  assert.equal(decision.reason, 'workflow-goal-incomplete-no-next-stage');
});

test('stage integration is part of the completion contract when configured', () => {
  const stage = {
    stageId: 'STAGE-B',
    lanes: [{ laneId: 'C1' }],
    integrationLane: { laneId: 'INT' }
  };
  const pending = stageCompletion(stage, [laneRow('C1', true)], laneRow('INT', false));
  assert.equal(pending.complete, false);
  assert.equal(pending.reason, 'stage-integration-incomplete');
  const complete = stageCompletion(stage, [laneRow('C1', true)], laneRow('INT', true));
  assert.equal(complete.complete, true);
});

test('workflow manifest is reloaded from the project repo while runtime state is preserved', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'chatsentinel-workflow-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }));
  await fs.mkdir(path.join(dir, 'control'), { recursive: true });
  await fs.writeFile(path.join(dir, 'control', 'chatsentinel-workflow.json'), JSON.stringify({
    enabled: true,
    goal: { label: 'multi-stage workflow', terminalStageId: 'TERMINAL' },
    stages: [
      { stageId: 'STAGE-A', lanes: [{ laneId: 'A' }] },
      { stageId: 'STAGE-B', lanes: [{ laneId: 'B' }] },
      { stageId: 'TERMINAL', lanes: [{ laneId: 'Z' }] }
    ]
  }), 'utf8');

  const workflow = await resolveWorkflow({
    repoPath: dir,
    workflow: {
      enabled: true,
      sourcePath: 'control/chatsentinel-workflow.json',
      currentStageId: 'STAGE-B',
      completedStageIds: ['STAGE-A']
    }
  });
  assert.equal(workflow.sourceResolved, true);
  assert.equal(selectCurrentStage(workflow).stageId, 'STAGE-B');
  assert.deepEqual(workflow.completedStageIds, ['STAGE-A']);
});

function fakeStore(project) {
  return {
    state: { commands: {} },
    configs: {},
    sessions: {},
    project,
    get commands() { return this.state.commands; },
    getProject(id) { return id === project.projectId ? this.project : null; },
    getSession(id) { return this.sessions[id] || {}; },
    async setProject(id, next) {
      assert.equal(id, project.projectId);
      this.project = next;
    },
    async saveNow() {}
  };
}

test('workflow advance persists the next stage and enqueues parallel next-stage lanes', async () => {
  const project = {
    projectId: 'project:p1',
    orchestration: { enabled: true, repoPath: 'repo', workflow: { enabled: true } }
  };
  const store = fakeStore(project);
  const workflow = normalizeWorkflow({
    enabled: true,
    currentStageId: 'STAGE-A',
    completedStageIds: [],
    terminalStageId: 'TERMINAL',
    maxParallelLanes: 2,
    stages: [
      { stageId: 'STAGE-A', lanes: [{ laneId: 'A', prompt: 'a' }] },
      {
        stageId: 'STAGE-B',
        lanes: [
          { laneId: 'B1', laneName: 'B1', prompt: 'b1', branch: 'feat/b1' },
          { laneId: 'B2', laneName: 'B2', prompt: 'b2', branch: 'feat/b2' },
          { laneId: 'B3', laneName: 'B3', prompt: 'b3', branch: 'feat/b3' }
        ]
      },
      { stageId: 'TERMINAL', lanes: [{ laneId: 'Z', prompt: 'z' }] }
    ]
  });
  const plan = {
    enabled: true,
    repoPath: 'repo',
    workflow: { enabled: true, currentStageId: 'STAGE-A', completedStageIds: [] },
    lanes: workflow.stages[0].lanes,
    integrationLane: null
  };
  const emitted = await advanceWorkflow(store, project, plan, workflow, {
    nextStageId: 'STAGE-B',
    completedStageIds: ['STAGE-A']
  });
  assert.equal(store.project.orchestration.workflow.currentStageId, 'STAGE-B');
  assert.deepEqual(store.project.orchestration.workflow.completedStageIds, ['STAGE-A']);
  assert.equal(store.project.orchestration.lanes.length, 3);
  assert.equal(emitted.commands.length, 2);
  assert.deepEqual(emitted.commands.map(row => row.payload.laneId), ['B1', 'B2']);
});

test('workflow replan emits a governance lane instead of silently stopping', async () => {
  const project = { projectId: 'project:p2', orchestration: { enabled: true } };
  const store = fakeStore(project);
  const workflow = normalizeWorkflow({
    enabled: true,
    goal: { label: 'multi-stage workflow', terminalStageId: 'TERMINAL' },
    sourcePath: 'control/chatsentinel-workflow.json',
    currentStageId: 'STAGE-B',
    completedStageIds: ['STAGE-A'],
    plannerLane: {
      laneId: 'WORKFLOW-PLAN',
      laneName: 'Workflow Review',
      prompt: 'Reconcile roadmap and add the next missing stage.',
      role: 'governance'
    },
    stages: [{ stageId: 'STAGE-B', lanes: [{ laneId: 'B' }] }]
  });
  const emitted = await replanWorkflow(
    store,
    project,
    workflow,
    workflow.stages[0],
    { reason: 'workflow-goal-incomplete-no-next-stage', completedStageIds: ['STAGE-A', 'STAGE-B'] }
  );
  assert.equal(emitted.command.type, 'CREATE_LANE_CHAT');
  assert.equal(emitted.command.payload.laneId, 'WORKFLOW-PLAN');
  assert.match(emitted.command.payload.prompt, /Reconcile roadmap/);
});

test('workflow completion is durably recorded only at the terminal contract', async () => {
  const project = {
    projectId: 'project:p3',
    orchestration: {
      enabled: true,
      workflow: { enabled: true, currentStageId: 'TERMINAL', completedStageIds: ['STAGE-A', 'STAGE-B'] }
    }
  };
  const store = fakeStore(project);
  const workflow = normalizeWorkflow({
    enabled: true,
    terminalStageId: 'TERMINAL',
    currentStageId: 'TERMINAL',
    completedStageIds: ['STAGE-A', 'STAGE-B'],
    stages: [{ stageId: 'TERMINAL', lanes: [{ laneId: 'FINAL' }] }]
  });
  const result = await completeWorkflow(
    store,
    project,
    project.orchestration,
    workflow,
    workflow.stages[0],
    { completedStageIds: ['STAGE-A', 'STAGE-B', 'TERMINAL'] }
  );
  assert.equal(result.workflowTransition.action, 'COMPLETE');
  assert.ok(store.project.orchestration.workflow.completedAt);
  assert.deepEqual(
    store.project.orchestration.workflow.completedStageIds,
    ['STAGE-A', 'STAGE-B', 'TERMINAL']
  );
});

test('orchestration config can derive the active lane set directly from a workflow', async () => {
  const project = { projectId: 'project:p4', projectPath: 'C:/repo' };
  const store = fakeStore(project);
  const result = await configureOrchestration(store, project.projectId, {
    enabled: true,
    repoPath: 'C:/repo',
    workflow: {
      enabled: true,
      goal: { terminalStageId: 'TERMINAL' },
      currentStageId: 'STAGE-A',
      stages: [
        {
          stageId: 'STAGE-A',
          lanes: [
            { laneId: 'STAGE-A-A', prompt: 'run A', branch: 'feat/a', baselineSha: 'base-a' },
            { laneId: 'STAGE-A-B', prompt: 'run B', branch: 'feat/b', baselineSha: 'base-b' }
          ]
        },
        { stageId: 'TERMINAL', lanes: [{ laneId: 'FINAL', prompt: 'final' }] }
      ]
    }
  });
  assert.equal(result.ok, true);
  assert.equal(result.orchestration.workflow.currentStageId, 'STAGE-A');
  assert.deepEqual(result.orchestration.lanes.map(row => row.laneId), ['STAGE-A-A', 'STAGE-A-B']);
});

test('workflow advance binds the exact green integration head to every next-stage lane', async () => {
  const green = 'cccccccccccccccccccccccccccccccccccccccc';
  const project = { projectId: 'project:baseline', orchestration: { enabled: true } };
  const store = fakeStore(project);
  const workflow = normalizeWorkflow({
    enabled: true,
    currentStageId: 'STAGE-A-W01',
    terminalStageId: 'TERMINAL-W01',
    maxParallelLanes: 8,
    stages: [
      { stageId: 'STAGE-A-W01', lanes: [{ laneId: 'A', branch: 'feat/a', baselineSha: 'base' }] },
      {
        stageId: 'STAGE-B-W01',
        lanes: [
          { laneId: 'B1', prompt: 'b1', branch: 'feat/b1' },
          { laneId: 'B2', prompt: 'b2', branch: 'feat/b2' }
        ],
        integrationLane: { laneId: 'INT-B', prompt: 'integrate', branch: 'integration/b' }
      },
      { stageId: 'TERMINAL-W01', lanes: [{ laneId: 'Z', prompt: 'z', branch: 'feat/z' }] }
    ]
  });
  const plan = {
    enabled: true,
    repoPath: 'repo',
    workflow,
    lanes: workflow.stages[0].lanes,
    integrationLane: null
  };
  const result = await advanceWorkflow(store, project, plan, workflow, {
    nextStageId: 'STAGE-B-W01',
    nextBaselineSha: green,
    completedStageIds: ['STAGE-A-W01']
  });
  assert.equal(store.project.orchestration.workflow.stageBaselines['STAGE-B-W01'], green);
  assert.deepEqual(store.project.orchestration.lanes.map(row => row.baselineSha), [green, green]);
  assert.equal(store.project.orchestration.integrationLane.baselineSha, green);
  assert.deepEqual(result.commands.map(row => row.payload.baselineSha), [green, green]);
  assert.equal(result.workflowTransition.baselineSha, green);
});

test('persisted stage baseline rebinds a source-backed manifest without changing its source file', async t => {
  const green = 'dddddddddddddddddddddddddddddddddddddddd';
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'chatsentinel-baseline-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }));
  await fs.mkdir(path.join(dir, 'control'), { recursive: true });
  const manifest = JSON.stringify({
    enabled: true,
    terminalStageId: 'TERMINAL-W01',
    stages: [
      { stageId: 'STAGE-B-W01', lanes: [{ laneId: 'B', branch: 'feat/b', prompt: 'b' }] },
      { stageId: 'TERMINAL-W01', lanes: [{ laneId: 'Z', branch: 'feat/z', prompt: 'z' }] }
    ]
  });
  const file = path.join(dir, 'control', 'chatsentinel-workflow.json');
  await fs.writeFile(file, manifest, 'utf8');
  const resolved = await resolveWorkflow({
    repoPath: dir,
    workflow: {
      enabled: true,
      sourcePath: 'control/chatsentinel-workflow.json',
      currentStageId: 'STAGE-B-W01',
      stageBaselines: { 'STAGE-B-W01': green }
    }
  });
  assert.equal(selectCurrentStage(resolved).lanes[0].baselineSha, green);
  assert.equal(await fs.readFile(file, 'utf8'), manifest);
});


test('orchestration rejects embedded workflow profiles from other repositories', async () => {
  const project = { projectId: 'project:boundary', projectPath: 'C:/owned-repo' };
  const store = fakeStore(project);
  const result = await configureOrchestration(store, project.projectId, {
    enabled: true,
    repoPath: 'C:/owned-repo',
    workflowProfileId: 'external/repository:roadmap:v1'
  });
  assert.equal(result.ok, false);
  assert.equal(result.error, 'workflow-profile-unsupported-use-project-owned-manifest');
});
