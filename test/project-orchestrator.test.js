import test from 'node:test';
import assert from 'node:assert/strict';
import { detectLaneCompletion, decideLaneAction, decideProjectAction, OrchestratorAction } from '../src/components/project-orchestrator/decision.js';
import { deriveLaneCommandHistory, laneCreateIdempotencyKey } from '../src/components/project-orchestrator/controller.js';

const lane = { laneId: 'C1', branch: 'feat/c1', baselineSha: 'base', prompt: 'go' };

test('missing chat rotates CREATE_LANE_CHAT idempotency generation after a prior success', () => {
  const commands = [
    { type: 'CREATE_LANE_CHAT', status: 'succeeded', idempotencyKey: 'orchestrator:p1:C1:create' },
    { type: 'CREATE_LANE_CHAT', status: 'failed', idempotencyKey: 'orchestrator:p1:C1:create:retry' },
    { type: 'SEND_PROMPT', status: 'failed', idempotencyKey: 'orchestrator:p1:C1:fix:t1' }
  ];
  const history = deriveLaneCommandHistory(commands, { projectId: 'p1', laneId: 'C1' });
  assert.equal(history.createGeneration, 1);
  assert.equal(history.fixAttempts, 1);
  assert.equal(laneCreateIdempotencyKey('p1', { laneId: 'C1', createGeneration: 0 }), 'orchestrator:p1:C1:create:0');
  assert.equal(laneCreateIdempotencyKey('p1', { laneId: 'C1', createGeneration: 1 }), 'orchestrator:p1:C1:create:1');
});

test('lane completion requires an advanced remote branch and idle chat', () => {
  const complete = detectLaneCompletion({ lane, session: { state: 'IDLE' }, git: { remoteHead: 'next', clean: true, localHead: 'next' } });
  assert.equal(complete.complete, true);
  const unchanged = detectLaneCompletion({ lane, session: { state: 'IDLE' }, git: { remoteHead: 'base', clean: true, localHead: 'base' } });
  assert.equal(unchanged.complete, false);
  assert.equal(unchanged.reason, 'branch-not-advanced');
  const dirty = detectLaneCompletion({ lane, session: { state: 'IDLE' }, git: { remoteHead: 'next', clean: false, localHead: 'next' } });
  assert.equal(dirty.complete, false);
});

test('orchestrator selects NEXT FIX and REPLACE deterministically', () => {
  assert.equal(decideLaneAction({ lane, session: {}, completion: { complete: false } }).action, OrchestratorAction.NEXT);
  assert.equal(decideLaneAction({ lane, session: { decision: { action: 'CONTINUE_SAME_CHAT' } }, completion: { complete: false } }).action, OrchestratorAction.FIX);
  assert.equal(decideLaneAction({ lane, session: { conversationDead: true }, completion: { complete: false } }).action, OrchestratorAction.REPLACE);
  assert.equal(decideLaneAction({ lane: { ...lane, fixAttempts: 2 }, session: { decision: { action: 'SAFE_RETRY' } }, completion: { complete: false } }).action, OrchestratorAction.REPLACE);
});

test('project integrates only after every required lane is complete', () => {
  const rows = [
    { lane: { laneId: 'C1' }, completion: { complete: true }, decision: { action: 'WAIT' } },
    { lane: { laneId: 'C2' }, completion: { complete: true }, decision: { action: 'WAIT' } }
  ];
  assert.equal(decideProjectAction(rows).action, OrchestratorAction.INTEGRATE);
  rows[1].completion.complete = false;
  rows[1].decision = { action: OrchestratorAction.FIX, reason: 'stalled' };
  assert.equal(decideProjectAction(rows).action, OrchestratorAction.FIX);
});

test('silent running chat becomes actionable after the stall window', () => {
  const session = {
    state: 'RUNNING',
    progressAgeMs: 1,
    updatedAt: new Date(Date.now() - 600000).toISOString(),
    decision: { action: 'WAIT' }
  };
  const result = decideLaneAction({ lane, session, completion: { complete: false, reason: 'chat-not-idle' } });
  assert.equal(result.action, OrchestratorAction.FIX);
  assert.equal(result.reason, 'lane-stalled');
});

test('idle lane with no branch progress is kicked after command grace', () => {
  const session = { state: 'IDLE', progressAgeMs: 5, updatedAt: new Date().toISOString(), decision: { action: 'WAIT' } };
  const lastCommand = { status: 'succeeded', completedAt: new Date(Date.now() - 180000).toISOString() };
  const result = decideLaneAction({ lane, session, completion: { complete: false, reason: 'branch-not-advanced' }, lastCommand });
  assert.equal(result.action, OrchestratorAction.FIX);
  assert.equal(result.reason, 'idle-no-branch-progress');
});

test('idle lane is not kicked before command grace expires', () => {
  const session = { state: 'IDLE', progressAgeMs: 5, updatedAt: new Date().toISOString(), decision: { action: 'WAIT' } };
  const lastCommand = { status: 'succeeded', completedAt: new Date().toISOString() };
  const result = decideLaneAction({ lane, session, completion: { complete: false, reason: 'branch-not-advanced' }, lastCommand });
  assert.equal(result.action, OrchestratorAction.WAIT);
});

test('idle lane replaces chat after fix budget is exhausted', () => {
  const session = { state: 'IDLE', progressAgeMs: 5, updatedAt: new Date().toISOString(), decision: { action: 'WAIT' } };
  const lastCommand = { status: 'succeeded', completedAt: new Date(Date.now() - 180000).toISOString() };
  const budgetedLane = { ...lane, fixAttempts: 2, maxFixAttempts: 2 };
  const result = decideLaneAction({ lane: budgetedLane, session, completion: { complete: false, reason: 'branch-not-advanced' }, lastCommand });
  assert.equal(result.action, OrchestratorAction.REPLACE);
  assert.equal(result.reason, 'fix-budget-exhausted');
});

test('missing exact lane contract blocks instead of launching with an unknown baseline', () => {
  const completion = detectLaneCompletion({
    lane: { laneId: 'C2', branch: 'feat/c2', baselineSha: '' },
    session: {},
    git: {}
  });
  assert.equal(completion.reason, 'lane-contract-incomplete');
  const decision = decideLaneAction({
    lane: { laneId: 'C2', branch: 'feat/c2', baselineSha: '' },
    session: {},
    completion
  });
  assert.equal(decision.action, OrchestratorAction.BLOCKED);
  assert.equal(decision.reason, 'lane-contract-incomplete');
});
