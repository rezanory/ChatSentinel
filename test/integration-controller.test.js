import test from 'node:test';
import assert from 'node:assert/strict';
import {
  IntegrationStatus,
  evaluateGreenLaneCandidates
} from '../src/components/integration-controller/policy.js';
import { createIntegrationController } from '../src/components/integration-controller/controller.js';

const BASE = '1'.repeat(40);
const CANDIDATE = '2'.repeat(40);
const SPINE = 'a'.repeat(40);
const FROZEN = 'b'.repeat(40);
const TREE = 'c'.repeat(40);

function lane(overrides = {}) {
  return {
    laneId: 'C1',
    branch: 'feat/c1',
    baselineSha: BASE,
    candidateSha: CANDIDATE,
    green: true,
    handoff: 'control/c1/HANDOFF.md',
    remoteHead: CANDIDATE,
    localHead: CANDIDATE,
    clean: true,
    ...overrides
  };
}

function makeHarness(options = {}) {
  const calls = [];
  const state = { active: 0, maxActive: 0, gatePass: options.gatePass !== false };
  const git = {
    async inspectSpine() {
      calls.push(['inspect']);
      return options.spine || {
        ok: true,
        branch: 'integration/reuse-completion-v1',
        head: SPINE,
        remoteHead: SPINE,
        clean: true,
        operationInProgress: false
      };
    },
    async createCheckpoint() {
      calls.push(['checkpoint']);
      return { head: SPINE };
    },
    async isAncestor({ ancestorSha }) {
      calls.push(['ancestor', ancestorSha]);
      return options.alreadyIntegrated === true;
    },
    async unionCandidate({ candidate }) {
      state.active += 1;
      state.maxActive = Math.max(state.maxActive, state.active);
      calls.push(['union', candidate.laneId]);
      if (options.unionDelayMs) {
        await new Promise(resolve => setTimeout(resolve, options.unionDelayMs));
      }
      state.active -= 1;
      if (options.unionFailLane === candidate.laneId) {
        return { ok: false, reason: 'cherry-pick-conflict' };
      }
      return { ok: true };
    },
    async rollback({ reason }) {
      calls.push(['rollback', reason]);
      return { ok: true };
    },
    async freezeCandidate() {
      calls.push(['freeze']);
      if (options.freeze) return options.freeze;
      return {
        ok: true,
        branch: 'integration/reuse-completion-v1',
        sha: FROZEN,
        tree: TREE,
        clean: true,
        localHead: FROZEN,
        remoteHead: FROZEN
      };
    }
  };
  const gateRuns = new Map();
  const gateRunner = {
    async run(name) {
      calls.push(['gate', name]);
      gateRuns.set(name, (gateRuns.get(name) || 0) + 1);
      if (typeof options.gateResult === 'function') return options.gateResult(name, gateRuns.get(name));
      return { ok: state.gatePass };
    }
  };
  const recovery = {
    async classifyFailure(failure) {
      calls.push(['classify', failure.name]);
      if (options.classifyFailureError) throw new Error('classification-offline');
      if (typeof options.classifyFailure === 'function') return options.classifyFailure(failure);
      return 'integration';
    },
    async fixForward({ round, failures }) {
      calls.push(['fix-forward', round, failures.map(row => row.name)]);
      if (options.fixForwardError) throw new Error('fix-forward-offline');
      if (options.fixForwardChanged === false) return { changed: false };
      state.gatePass = true;
      return { changed: true };
    },
    async requestLaneFix(detail) {
      calls.push(['lane-fix', detail.laneId, detail.reason]);
      return { ok: true };
    }
  };
  const queue = {
    async enqueueNextLane(payload) {
      calls.push(['next', payload.nextLane.laneId, payload.idempotencyKey]);
      if (options.nextLaneError) throw new Error('queue-offline');
      return { commandId: 'cmd:next' };
    }
  };
  return { calls, state, git, gateRunner, recovery, queue };
}

function controller(harness) {
  return createIntegrationController({
    git: harness.git,
    gateRunner: harness.gateRunner,
    recovery: harness.recovery,
    queue: harness.queue
  });
}

function input(overrides = {}) {
  return {
    integration: {
      branch: 'integration/reuse-completion-v1',
      worktreePath: 'C:\\ChatSentinel',
      expectedHead: SPINE
    },
    lanes: [lane()],
    gates: ['test', 'check', 'e2e'],
    nextLane: { laneId: 'NEXT', branch: 'feat/next' },
    ...overrides
  };
}

test('candidate evaluation requires exact green advanced handoff-bound lane heads', () => {
  const ready = evaluateGreenLaneCandidates([lane()]);
  assert.equal(ready.ready, true);

  const blocked = evaluateGreenLaneCandidates([
    lane({
      candidateSha: BASE,
      green: false,
      handoff: '',
      remoteHead: CANDIDATE
    })
  ]);
  assert.equal(blocked.ready, false);
  assert.deepEqual(
    new Set(blocked.failures.map(row => row.reason)),
    new Set(['branch-not-advanced', 'candidate-not-green', 'handoff-missing', 'remote-head-mismatch', 'local-head-mismatch'])
  );
});

test('candidate evaluation rejects missing exact reconciliation evidence', () => {
  const blocked = evaluateGreenLaneCandidates([
    lane({ baselineSha: '', remoteHead: '', localHead: '', clean: undefined })
  ]);
  assert.equal(blocked.ready, false);
  assert.deepEqual(
    new Set(blocked.failures.map(row => row.reason)),
    new Set(['baseline-sha-invalid', 'remote-head-invalid', 'local-head-invalid', 'candidate-worktree-not-clean'])
  );
});

test('dirty or unreconciled integration spine blocks before any union', async () => {
  const harness = makeHarness({
    spine: {
      ok: true,
      branch: 'integration/reuse-completion-v1',
      head: SPINE,
      remoteHead: FROZEN,
      clean: false
    }
  });
  const outcome = await controller(harness).run(input());
  assert.equal(outcome.status, IntegrationStatus.SPINE_BLOCKED);
  assert.equal(harness.calls.some(call => call[0] === 'union'), false);
});

test('every gate runs after an early failure and integration-scope fix-forward revalidates the full set', async () => {
  const harness = makeHarness({ gatePass: false });
  const outcome = await controller(harness).run(input());
  assert.equal(outcome.status, IntegrationStatus.GREEN);
  assert.equal(outcome.fixForwardRounds, 1);
  assert.deepEqual(
    harness.calls.filter(call => call[0] === 'gate').map(call => call[1]),
    ['test', 'check', 'e2e', 'test', 'check', 'e2e']
  );
  assert.equal(harness.calls.some(call => call[0] === 'freeze'), true);
  assert.equal(harness.calls.some(call => call[0] === 'next'), true);
});

test('recovery adapter exceptions become structured failures and roll back safely', async () => {
  const classifyHarness = makeHarness({ gatePass: false, classifyFailureError: true });
  const classifyOutcome = await controller(classifyHarness).run(input());
  assert.equal(classifyOutcome.status, IntegrationStatus.FIX_REQUIRED);
  assert.equal(classifyOutcome.failurePolicy.action, 'BLOCK');
  assert.equal(classifyHarness.calls.some(call => call[0] === 'rollback' && call[1] === 'gate-failed'), true);

  const fixHarness = makeHarness({ gatePass: false, fixForwardError: true });
  const fixOutcome = await controller(fixHarness).run(input());
  assert.equal(fixOutcome.status, IntegrationStatus.FIX_REQUIRED);
  assert.equal(fixOutcome.failurePolicy.action, 'BLOCK');
  assert.equal(fixHarness.calls.some(call => call[0] === 'rollback' && call[1] === 'gate-failed'), true);
});

test('lane-owned gate failure rolls back and requests lane fix without freezing', async () => {
  const harness = makeHarness({
    gatePass: false,
    classifyFailure: () => ({ scope: 'lane', laneId: 'C1' })
  });
  const outcome = await controller(harness).run(input({ maxFixForwardRounds: 3 }));
  assert.equal(outcome.status, IntegrationStatus.FIX_REQUIRED);
  assert.equal(outcome.failurePolicy.action, 'LANE_FIX');
  assert.equal(harness.calls.some(call => call[0] === 'rollback' && call[1] === 'gate-failed'), true);
  assert.equal(harness.calls.some(call => call[0] === 'lane-fix' && call[1] === 'C1'), true);
  assert.equal(harness.calls.some(call => call[0] === 'freeze'), false);
});

test('union conflict restores the checkpoint and routes the exact lane to recovery', async () => {
  const harness = makeHarness({ unionFailLane: 'C1' });
  const outcome = await controller(harness).run(input());
  assert.equal(outcome.status, IntegrationStatus.UNION_FAILED);
  assert.equal(outcome.laneId, 'C1');
  assert.equal(harness.calls.some(call => call[0] === 'rollback' && call[1] === 'union-failed'), true);
  assert.equal(harness.calls.some(call => call[0] === 'lane-fix' && call[1] === 'C1'), true);
  assert.equal(harness.calls.some(call => call[0] === 'gate'), false);
});

test('controller serializes concurrent integration attempts', async () => {
  const harness = makeHarness({ unionDelayMs: 30 });
  const ctl = controller(harness);
  const [first, second] = await Promise.all([
    ctl.run(input({ nextLane: null })),
    ctl.run(input({ nextLane: null }))
  ]);
  assert.equal(first.status, IntegrationStatus.GREEN);
  assert.equal(second.status, IntegrationStatus.GREEN);
  assert.equal(harness.state.maxActive, 1);
});

test('already-integrated exact candidate is skipped but all gates and freeze still run', async () => {
  const harness = makeHarness({ alreadyIntegrated: true });
  const outcome = await controller(harness).run(input({ nextLane: null }));
  assert.equal(outcome.status, IntegrationStatus.GREEN);
  assert.equal(harness.calls.some(call => call[0] === 'union'), false);
  assert.equal(harness.calls.filter(call => call[0] === 'gate').length, 3);
  assert.equal(outcome.unionResults[0].skipped, 'already-integrated');
});

test('candidate freeze requires exact clean local and remote heads before next-lane enqueue', async () => {
  const harness = makeHarness({
    freeze: {
      ok: true,
      branch: 'integration/reuse-completion-v1',
      sha: FROZEN,
      tree: TREE,
      clean: true,
      localHead: FROZEN,
      remoteHead: SPINE
    }
  });
  const outcome = await controller(harness).run(input());
  assert.equal(outcome.status, IntegrationStatus.FREEZE_FAILED);
  assert.equal(outcome.reason, 'freeze-remote-head-mismatch');
  assert.equal(harness.calls.some(call => call[0] === 'rollback' && call[1] === 'freeze-failed'), true);
  assert.equal(harness.calls.some(call => call[0] === 'next'), false);
});

test('green freeze is preserved when next-lane queue is temporarily unavailable', async () => {
  const harness = makeHarness({ nextLaneError: true });
  const outcome = await controller(harness).run(input());
  assert.equal(outcome.status, IntegrationStatus.GREEN_NEXT_PENDING);
  assert.equal(outcome.ok, false);
  assert.equal(outcome.candidate.sha, FROZEN);
  assert.equal(harness.calls.some(call => call[0] === 'rollback'), false);
});
