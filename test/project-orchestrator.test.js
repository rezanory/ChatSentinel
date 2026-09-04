import test from 'node:test';
import assert from 'node:assert/strict';
import { detectLaneCompletion, decideLaneAction, decideProjectAction, OrchestratorAction } from '../src/components/project-orchestrator/decision.js';

const lane = { laneId: 'C1', branch: 'feat/c1', baselineSha: 'base', prompt: 'go' };

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
