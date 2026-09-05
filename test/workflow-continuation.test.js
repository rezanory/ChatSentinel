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
    goal: { id: 'g', label: 'PH7 to PH10.5', terminalStageId: 'PH10.5' },
    currentStageId: 'PH7',
    stages: [
      { stageId: 'PH7', lanes: [{ laneId: 'C1' }] },
      { stageId: 'PH8', lanes: [{ laneId: 'C2' }] },
      { stageId: 'PH10.5', lanes: [{ laneId: 'C3' }] }
    ]
  });
  const stage = selectCurrentStage(workflow);
  assert.equal(stage.stageId, 'PH7');
  const completion = stageCompletion(stage, [laneRow('C1', true)]);
  assert.equal(completion.complete, true);
  const decision = evaluateWorkflow(workflow, stage, completion);
  assert.equal(decision.action, 'ADVANCE');
  assert.equal(decision.nextStageId, 'PH8');
  assert.deepEqual(decision.completedStageIds, ['PH7']);
});

test('workflow only completes when the configured terminal stage is complete', () => {
  const workflow = normalizeWorkflow({
    enabled: true,
    terminalStageId: 'PH10.5',
    currentStageId: 'PH10.5',
    completedStageIds: ['PH7', 'PH8', 'PH9', 'PH10'],
    stages: [{ stageId: 'PH10.5', lanes: [{ laneId: 'FINAL' }] }]
  });
  const stage = selectCurrentStage(workflow);
  const decision = evaluateWorkflow(workflow, stage, stageCompletion(stage, [laneRow('FINAL', true)]));
  assert.equal(decision.action, 'COMPLETE');
  assert.equal(decision.reason, 'workflow-terminal-stage-complete');
});

test('workflow refuses false completion when the manifest ends before the goal', () => {
  const workflow = normalizeWorkflow({
    enabled: true,
    terminalStageId: 'PH10.5',
    currentStageId: 'PH8',
    plannerLane: { laneId: 'PLAN', prompt: 'Reconcile roadmap' },
    stages: [{ stageId: 'PH8', lanes: [{ laneId: 'C2' }] }]
  });
  const stage = selectCurrentStage(workflow);
  const decision = evaluateWorkflow(workflow, stage, stageCompletion(stage, [laneRow('C2', true)]));
  assert.equal(decision.action, 'REPLAN');
  assert.equal(decision.reason, 'workflow-goal-incomplete-no-next-stage');
});

test('stage integration is part of the completion contract when configured', () => {
  const stage = {
    stageId: 'PH8',
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
    goal: { label: 'PH7 to PH10.5', terminalStageId: 'PH10.5' },
    stages: [
      { stageId: 'PH7', lanes: [{ laneId: 'A' }] },
      { stageId: 'PH8', lanes: [{ laneId: 'B' }] },
      { stageId: 'PH10.5', lanes: [{ laneId: 'Z' }] }
    ]
  }), 'utf8');

  const workflow = await resolveWorkflow({
    repoPath: dir,
    workflow: {
      enabled: true,
      sourcePath: 'control/chatsentinel-workflow.json',
      currentStageId: 'PH8',
      completedStageIds: ['PH7']
    }
  });
  assert.equal(workflow.sourceResolved, true);
  assert.equal(selectCurrentStage(workflow).stageId, 'PH8');
  assert.deepEqual(workflow.completedStageIds, ['PH7']);
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
    currentStageId: 'PH7',
    completedStageIds: [],
    terminalStageId: 'PH10.5',
    maxParallelLanes: 2,
    stages: [
      { stageId: 'PH7', lanes: [{ laneId: 'A', prompt: 'a' }] },
      {
        stageId: 'PH8',
        lanes: [
          { laneId: 'B1', laneName: 'B1', prompt: 'b1', branch: 'feat/b1' },
          { laneId: 'B2', laneName: 'B2', prompt: 'b2', branch: 'feat/b2' },
          { laneId: 'B3', laneName: 'B3', prompt: 'b3', branch: 'feat/b3' }
        ]
      },
      { stageId: 'PH10.5', lanes: [{ laneId: 'Z', prompt: 'z' }] }
    ]
  });
  const plan = {
    enabled: true,
    repoPath: 'repo',
    workflow: { enabled: true, currentStageId: 'PH7', completedStageIds: [] },
    lanes: workflow.stages[0].lanes,
    integrationLane: null
  };
  const emitted = await advanceWorkflow(store, project, plan, workflow, {
    nextStageId: 'PH8',
    completedStageIds: ['PH7']
  });
  assert.equal(store.project.orchestration.workflow.currentStageId, 'PH8');
  assert.deepEqual(store.project.orchestration.workflow.completedStageIds, ['PH7']);
  assert.equal(store.project.orchestration.lanes.length, 3);
  assert.equal(emitted.commands.length, 2);
  assert.deepEqual(emitted.commands.map(row => row.payload.laneId), ['B1', 'B2']);
});

test('workflow replan emits a governance lane instead of silently stopping', async () => {
  const project = { projectId: 'project:p2', orchestration: { enabled: true } };
  const store = fakeStore(project);
  const workflow = normalizeWorkflow({
    enabled: true,
    goal: { label: 'PH7 to PH10.5', terminalStageId: 'PH10.5' },
    sourcePath: 'control/chatsentinel-workflow.json',
    currentStageId: 'PH8',
    completedStageIds: ['PH7'],
    plannerLane: {
      laneId: 'WORKFLOW-PLAN',
      laneName: 'Workflow Review',
      prompt: 'Reconcile roadmap and add the next missing stage.',
      role: 'governance'
    },
    stages: [{ stageId: 'PH8', lanes: [{ laneId: 'B' }] }]
  });
  const emitted = await replanWorkflow(
    store,
    project,
    workflow,
    workflow.stages[0],
    { reason: 'workflow-goal-incomplete-no-next-stage', completedStageIds: ['PH7', 'PH8'] }
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
      workflow: { enabled: true, currentStageId: 'PH10.5', completedStageIds: ['PH7', 'PH8'] }
    }
  };
  const store = fakeStore(project);
  const workflow = normalizeWorkflow({
    enabled: true,
    terminalStageId: 'PH10.5',
    currentStageId: 'PH10.5',
    completedStageIds: ['PH7', 'PH8'],
    stages: [{ stageId: 'PH10.5', lanes: [{ laneId: 'FINAL' }] }]
  });
  const result = await completeWorkflow(
    store,
    project,
    project.orchestration,
    workflow,
    workflow.stages[0],
    { completedStageIds: ['PH7', 'PH8', 'PH10.5'] }
  );
  assert.equal(result.workflowTransition.action, 'COMPLETE');
  assert.ok(store.project.orchestration.workflow.completedAt);
  assert.deepEqual(
    store.project.orchestration.workflow.completedStageIds,
    ['PH7', 'PH8', 'PH10.5']
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
      goal: { terminalStageId: 'PH10.5' },
      currentStageId: 'PH7',
      stages: [
        {
          stageId: 'PH7',
          lanes: [
            { laneId: 'PH7-A', prompt: 'run A', branch: 'feat/a', baselineSha: 'base-a' },
            { laneId: 'PH7-B', prompt: 'run B', branch: 'feat/b', baselineSha: 'base-b' }
          ]
        },
        { stageId: 'PH10.5', lanes: [{ laneId: 'FINAL', prompt: 'final' }] }
      ]
    }
  });
  assert.equal(result.ok, true);
  assert.equal(result.orchestration.workflow.currentStageId, 'PH7');
  assert.deepEqual(result.orchestration.lanes.map(row => row.laneId), ['PH7-A', 'PH7-B']);
});

test('workflow advance binds the exact green integration head to every next-stage lane', async () => {
  const green = 'cccccccccccccccccccccccccccccccccccccccc';
  const project = { projectId: 'project:baseline', orchestration: { enabled: true } };
  const store = fakeStore(project);
  const workflow = normalizeWorkflow({
    enabled: true,
    currentStageId: 'PH7-W01',
    terminalStageId: 'PH10.5-W01',
    maxParallelLanes: 8,
    stages: [
      { stageId: 'PH7-W01', lanes: [{ laneId: 'A', branch: 'feat/a', baselineSha: 'base' }] },
      {
        stageId: 'PH8-W01',
        lanes: [
          { laneId: 'B1', prompt: 'b1', branch: 'feat/b1' },
          { laneId: 'B2', prompt: 'b2', branch: 'feat/b2' }
        ],
        integrationLane: { laneId: 'INT-B', prompt: 'integrate', branch: 'integration/b' }
      },
      { stageId: 'PH10.5-W01', lanes: [{ laneId: 'Z', prompt: 'z', branch: 'feat/z' }] }
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
    nextStageId: 'PH8-W01',
    nextBaselineSha: green,
    completedStageIds: ['PH7-W01']
  });
  assert.equal(store.project.orchestration.workflow.stageBaselines['PH8-W01'], green);
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
    terminalStageId: 'PH10.5-W01',
    stages: [
      { stageId: 'PH8-W01', lanes: [{ laneId: 'B', branch: 'feat/b', prompt: 'b' }] },
      { stageId: 'PH10.5-W01', lanes: [{ laneId: 'Z', branch: 'feat/z', prompt: 'z' }] }
    ]
  });
  const file = path.join(dir, 'control', 'chatsentinel-workflow.json');
  await fs.writeFile(file, manifest, 'utf8');
  const resolved = await resolveWorkflow({
    repoPath: dir,
    workflow: {
      enabled: true,
      sourcePath: 'control/chatsentinel-workflow.json',
      currentStageId: 'PH8-W01',
      stageBaselines: { 'PH8-W01': green }
    }
  });
  assert.equal(selectCurrentStage(resolved).lanes[0].baselineSha, green);
  assert.equal(await fs.readFile(file, 'utf8'), manifest);
});
