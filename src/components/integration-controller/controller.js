import {
  IntegrationStatus,
  collectGateFailures,
  decideGateFailurePolicy,
  evaluateGreenLaneCandidates,
  validateFrozenCandidate
} from './policy.js';

export class IntegrationController {
  #tail = Promise.resolve();

  constructor({ git, gateRunner, recovery = {}, queue = {}, logger = {} } = {}) {
    requireMethod(git, 'inspectSpine');
    requireMethod(git, 'unionCandidate');
    requireMethod(git, 'rollback');
    requireMethod(git, 'freezeCandidate');
    requireMethod(gateRunner, 'run');
    this.git = git;
    this.gateRunner = gateRunner;
    this.recovery = recovery;
    this.queue = queue;
    this.logger = logger;
  }

  run(input = {}) {
    const task = this.#tail.then(
      () => this.#runSerialized(input),
      () => this.#runSerialized(input)
    );
    this.#tail = task.catch(() => undefined);
    return task;
  }

  async #runSerialized(input) {
    const evaluation = evaluateGreenLaneCandidates(input.lanes);
    if (!evaluation.ready) {
      return result(IntegrationStatus.WAITING_CANDIDATES, {
        reason: 'required-lane-candidate-not-ready',
        candidateFailures: evaluation.failures
      });
    }

    const execute = () => this.#integrate(input, evaluation.candidates);
    if (typeof this.git.withExclusiveIntegrationLease === 'function') {
      const key = `integration:${input.integration?.branch || 'unknown'}`;
      return this.git.withExclusiveIntegrationLease(key, execute);
    }
    return execute();
  }

  async #integrate(input, candidates) {
    const integration = normalizeIntegration(input.integration);
    const spine = await this.git.inspectSpine(integration);
    const preflight = inspectPreflight(spine, integration);
    if (!preflight.ok) {
      return result(IntegrationStatus.SPINE_BLOCKED, { reason: preflight.reason, spine });
    }

    const checkpoint = typeof this.git.createCheckpoint === 'function'
      ? await this.git.createCheckpoint({ integration, spine })
      : { head: spine.head };
    const unionResults = [];

    for (const candidate of candidates) {
      if (typeof this.git.isAncestor === 'function') {
        const alreadyIntegrated = await this.git.isAncestor({
          integration,
          ancestorSha: candidate.candidateSha,
          descendantSha: spine.head
        });
        if (alreadyIntegrated === true) {
          unionResults.push({ laneId: candidate.laneId, ok: true, skipped: 'already-integrated' });
          continue;
        }
      }

      let union;
      try {
        union = await this.git.unionCandidate({
          integration,
          candidate,
          checkpoint,
          strategy: 'cherry-pick-range'
        });
      } catch (error) {
        union = { ok: false, reason: 'union-exception', error: error.message };
      }
      unionResults.push({ laneId: candidate.laneId, ...union });
      if (!union?.ok) {
        await this.#rollback(integration, checkpoint, 'union-failed');
        await this.#requestLaneFix([candidate.laneId], {
          reason: union?.reason || 'union-failed',
          candidate,
          union
        });
        return result(IntegrationStatus.UNION_FAILED, {
          reason: union?.reason || 'union-failed',
          laneId: candidate.laneId,
          unionResults
        });
      }
    }

    const gateNames = normalizeGates(input.gates);
    let gateResults = await this.#runAllGates(gateNames, { input, candidates, integration, checkpoint });
    let failures = await this.#classifyFailures(collectGateFailures(gateResults), { input, candidates, integration });
    const maxRounds = clampInteger(input.maxFixForwardRounds, 0, 5, 1);
    let fixForwardRounds = 0;

    while (failures.length && fixForwardRounds < maxRounds) {
      const policy = decideGateFailurePolicy(failures);
      if (policy.action !== 'FIX_FORWARD' || typeof this.recovery.fixForward !== 'function') break;
      let fix;
      try {
        fix = await this.recovery.fixForward({
          integration,
          checkpoint,
          failures,
          round: fixForwardRounds + 1
        });
      } catch (error) {
        failures = [...failures, {
          name: 'integration-fix-forward',
          ok: false,
          reason: 'fix-forward-exception',
          error: error.message,
          scope: 'unclassified'
        }];
        break;
      }
      fixForwardRounds += 1;
      if (!fix?.changed) break;
      gateResults = await this.#runAllGates(gateNames, { input, candidates, integration, checkpoint, revalidation: true });
      failures = await this.#classifyFailures(collectGateFailures(gateResults), { input, candidates, integration });
    }

    if (failures.length) {
      const policy = decideGateFailurePolicy(failures);
      await this.#rollback(integration, checkpoint, 'gate-failed');
      if (policy.action === 'LANE_FIX') {
        await this.#requestLaneFix(policy.laneIds, { reason: 'lane-gate-failure', failures });
      }
      return result(IntegrationStatus.FIX_REQUIRED, {
        reason: policy.action === 'BLOCK' ? 'gate-failure-unclassified' : 'gate-failure',
        failurePolicy: policy,
        gateResults,
        failures,
        fixForwardRounds
      });
    }

    let freeze;
    try {
      freeze = await this.git.freezeCandidate({
        integration,
        checkpoint,
        candidates,
        gateResults,
        unionResults
      });
    } catch (error) {
      freeze = { ok: false, reason: 'freeze-exception', error: error.message };
    }
    const frozen = validateFrozenCandidate(freeze, integration.branch);
    if (!frozen.ok) {
      await this.#rollback(integration, checkpoint, 'freeze-failed');
      return result(IntegrationStatus.FREEZE_FAILED, {
        reason: frozen.reason,
        freeze,
        gateResults,
        unionResults
      });
    }

    const next = await this.#enqueueNextLane(input.nextLane, integration, freeze);
    const status = next.ok ? IntegrationStatus.GREEN : IntegrationStatus.GREEN_NEXT_PENDING;
    const output = result(status, {
      reason: next.ok ? 'integration-candidate-green' : 'integration-green-next-lane-pending',
      candidate: { sha: freeze.sha, tree: freeze.tree, branch: freeze.branch },
      gateResults,
      unionResults,
      fixForwardRounds,
      nextLane: next
    });
    this.logger.info?.('integration-controller-result', output);
    return output;
  }

  async #runAllGates(gates, context) {
    const rows = [];
    for (const gate of gates) {
      try {
        const value = await this.gateRunner.run(gate, context);
        rows.push(normalizeGateResult(gate, value));
      } catch (error) {
        rows.push({ name: gate, ok: false, reason: 'gate-exception', error: error.message });
      }
    }
    return rows;
  }

  async #classifyFailures(failures, context) {
    const rows = [];
    for (const failure of failures) {
      let classification = failure.scope ? { scope: failure.scope, laneId: failure.laneId } : null;
      if (!classification && typeof this.recovery.classifyFailure === 'function') {
        try {
          classification = await this.recovery.classifyFailure(failure, context);
        } catch (error) {
          rows.push({
            ...failure,
            ...normalizeClassification(null),
            classificationError: error.message
          });
          continue;
        }
      }
      rows.push({ ...failure, ...normalizeClassification(classification) });
    }
    return rows;
  }

  async #requestLaneFix(laneIds, detail) {
    if (typeof this.recovery.requestLaneFix !== 'function') return [];
    const emitted = [];
    for (const laneId of [...new Set(laneIds.filter(Boolean))]) {
      try {
        emitted.push(await this.recovery.requestLaneFix({ laneId, ...detail }));
      } catch (error) {
        emitted.push({ ok: false, laneId, reason: 'lane-fix-request-failed', error: error.message });
      }
    }
    return emitted;
  }

  async #rollback(integration, checkpoint, reason) {
    try {
      await this.git.rollback({ integration, checkpoint, reason });
    } catch (error) {
      this.logger.error?.('integration-controller-rollback-failed', { reason, error: error.message });
      throw error;
    }
  }

  async #enqueueNextLane(nextLane, integration, freeze) {
    if (!nextLane) return { ok: true, skipped: 'no-next-lane' };
    if (typeof this.queue.enqueueNextLane !== 'function') {
      return { ok: false, reason: 'next-lane-queue-unavailable' };
    }
    const idempotencyKey = `integration:${integration.branch}:${freeze.sha}:next:${nextLane.laneId || nextLane.branch || 'lane'}`;
    try {
      const queued = await this.queue.enqueueNextLane({
        nextLane,
        integrationCandidate: { sha: freeze.sha, tree: freeze.tree, branch: freeze.branch },
        idempotencyKey
      });
      return { ok: true, idempotencyKey, queued };
    } catch (error) {
      return { ok: false, reason: 'next-lane-enqueue-failed', error: error.message, idempotencyKey };
    }
  }
}

export function createIntegrationController(dependencies) {
  return new IntegrationController(dependencies);
}

function inspectPreflight(spine, integration) {
  if (!integration.branch) return { ok: false, reason: 'integration-branch-required' };
  if (!spine?.ok) return { ok: false, reason: spine?.reason || 'spine-inspection-failed' };
  if (spine.branch !== integration.branch) return { ok: false, reason: 'spine-branch-mismatch' };
  if (spine.clean !== true) return { ok: false, reason: 'spine-worktree-dirty' };
  if (spine.operationInProgress) return { ok: false, reason: 'spine-operation-in-progress' };
  if (!spine.head) return { ok: false, reason: 'spine-head-missing' };
  if (spine.remoteHead && spine.remoteHead !== spine.head) return { ok: false, reason: 'spine-not-reconciled' };
  if (integration.expectedHead && spine.head !== integration.expectedHead) {
    return { ok: false, reason: 'spine-head-mismatch' };
  }
  return { ok: true };
}

function normalizeIntegration(value = {}) {
  return {
    branch: String(value.branch || '').trim(),
    worktreePath: String(value.worktreePath || '').trim(),
    repoPath: String(value.repoPath || '').trim(),
    expectedHead: value.expectedHead ? String(value.expectedHead).trim() : undefined
  };
}

function normalizeGates(gates) {
  if (!Array.isArray(gates) || !gates.length) {
    return ['test', 'check', 'policy-check', 'e2e', 'prod-smoke', 'security-audit'];
  }
  return gates.map(gate => String(gate).trim()).filter(Boolean);
}

function normalizeGateResult(name, value) {
  if (value && typeof value === 'object') return { name, ...value, ok: value.ok === true };
  return { name, ok: value === true };
}

function normalizeClassification(value) {
  if (typeof value === 'string') {
    if (value.startsWith('lane:')) return { scope: 'lane', laneId: value.slice(5) || undefined };
    if (value === 'lane' || value === 'integration') return { scope: value };
    return { scope: 'unclassified' };
  }
  if (value && typeof value === 'object') {
    const scope = value.scope === 'lane' || value.scope === 'integration' ? value.scope : 'unclassified';
    return { scope, laneId: value.laneId ? String(value.laneId) : undefined };
  }
  return { scope: 'unclassified' };
}

function requireMethod(value, method) {
  if (!value || typeof value[method] !== 'function') {
    throw new TypeError(`integration-controller requires ${method}()`);
  }
}

function clampInteger(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(number)));
}

function result(status, detail) {
  return { ok: status === IntegrationStatus.GREEN, status, ...detail };
}
