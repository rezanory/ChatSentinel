const SHA_RE = /^[0-9a-f]{40}$/i;

export const IntegrationStatus = Object.freeze({
  WAITING_CANDIDATES: 'WAITING_CANDIDATES',
  SPINE_BLOCKED: 'SPINE_BLOCKED',
  UNION_FAILED: 'UNION_FAILED',
  FIX_REQUIRED: 'FIX_REQUIRED',
  FREEZE_FAILED: 'FREEZE_FAILED',
  GREEN: 'GREEN',
  GREEN_NEXT_PENDING: 'GREEN_NEXT_PENDING'
});

export function evaluateGreenLaneCandidates(lanes = []) {
  const candidates = Array.isArray(lanes)
    ? lanes.filter(lane => lane && lane.required !== false)
    : [];
  const failures = [];
  if (!candidates.length) {
    failures.push({ laneId: null, reason: 'required-lanes-empty' });
    return { ready: false, candidates, failures };
  }

  for (const lane of candidates) {
    const laneId = clean(lane.laneId);
    const branch = clean(lane.branch);
    const candidateSha = clean(lane.candidateSha);
    const baselineSha = clean(lane.baselineSha);
    if (!laneId) failures.push({ laneId: null, reason: 'lane-id-missing' });
    if (!branch) failures.push({ laneId, reason: 'branch-missing' });
    if (!SHA_RE.test(candidateSha)) failures.push({ laneId, reason: 'candidate-sha-invalid' });
    if (!SHA_RE.test(baselineSha)) {
      failures.push({ laneId, reason: 'baseline-sha-invalid' });
    } else if (SHA_RE.test(candidateSha) && baselineSha === candidateSha) {
      failures.push({ laneId, reason: 'branch-not-advanced' });
    }
    if (!(lane.green === true || String(lane.status || '').toLowerCase() === 'green')) {
      failures.push({ laneId, reason: 'candidate-not-green' });
    }
    if (!handoffPresent(lane.handoff)) failures.push({ laneId, reason: 'handoff-missing' });
    const remoteHead = clean(lane.remoteHead);
    const localHead = clean(lane.localHead);
    if (!SHA_RE.test(remoteHead)) {
      failures.push({ laneId, reason: 'remote-head-invalid' });
    } else if (remoteHead !== candidateSha) {
      failures.push({ laneId, reason: 'remote-head-mismatch' });
    }
    if (!SHA_RE.test(localHead)) {
      failures.push({ laneId, reason: 'local-head-invalid' });
    } else if (localHead !== candidateSha) {
      failures.push({ laneId, reason: 'local-head-mismatch' });
    }
    if (lane.clean !== true) failures.push({ laneId, reason: 'candidate-worktree-not-clean' });
  }
  return { ready: failures.length === 0, candidates, failures };
}

export function collectGateFailures(results = []) {
  return results.filter(result => result?.ok !== true);
}

export function decideGateFailurePolicy(failures = []) {
  if (!failures.length) return { action: 'NONE', laneIds: [] };
  const laneIds = [...new Set(
    failures.filter(failure => failure.scope === 'lane' && failure.laneId)
      .map(failure => String(failure.laneId))
  )];
  if (failures.some(failure => failure.scope === 'lane')) {
    return { action: 'LANE_FIX', laneIds };
  }
  if (failures.every(failure => failure.scope === 'integration')) {
    return { action: 'FIX_FORWARD', laneIds: [] };
  }
  return { action: 'BLOCK', laneIds: [] };
}

export function validateFrozenCandidate(freeze, expectedBranch) {
  if (!freeze?.ok) return { ok: false, reason: freeze?.reason || 'freeze-failed' };
  if (!SHA_RE.test(clean(freeze.sha))) return { ok: false, reason: 'freeze-sha-invalid' };
  if (!SHA_RE.test(clean(freeze.tree))) return { ok: false, reason: 'freeze-tree-invalid' };
  if (expectedBranch && clean(freeze.branch) !== clean(expectedBranch)) {
    return { ok: false, reason: 'freeze-branch-mismatch' };
  }
  if (freeze.clean !== true) return { ok: false, reason: 'freeze-worktree-dirty' };
  if (clean(freeze.localHead) !== clean(freeze.sha)) {
    return { ok: false, reason: 'freeze-local-head-mismatch' };
  }
  if (clean(freeze.remoteHead) !== clean(freeze.sha)) {
    return { ok: false, reason: 'freeze-remote-head-mismatch' };
  }
  return { ok: true };
}

function handoffPresent(value) {
  if (value === true) return true;
  if (typeof value === 'string') return Boolean(value.trim());
  if (!value || typeof value !== 'object' || value.present === false) return false;
  return Boolean(value.path || value.sha || value.commit || value.validated === true);
}

function clean(value) {
  return typeof value === 'string' ? value.trim() : '';
}
