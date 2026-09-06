export function classifySideEffectRisk(input = {}) {
  return sideEffectEvidence(input).risk;
}

export function sideEffectEvidence({ signal = {}, reconciliation, previous, policy = {} } = {}) {
  const reasons = [];
  const explicit = String(signal.sideEffectRisk || '').toLowerCase();
  if (explicit && explicit !== 'unknown') {
    return { risk: explicit, reasons: ['signal-explicit-risk'] };
  }

  if (signal.state === 'RUNNING' || signal.externalActivity) {
    return { risk: 'possible', reasons: ['execution-active'] };
  }

  const prevR = previous?.reconciliation;
  if (changed(prevR?.remoteHead, reconciliation?.remoteHead)) {
    return { risk: 'confirmed', reasons: ['remote-head-moved'] };
  }
  if (changed(prevR?.head, reconciliation?.head)) {
    return { risk: 'confirmed', reasons: ['local-head-moved'] };
  }

  const summary = reconciliation?.changeSummary;
  if (Number(summary?.conflicted || 0) > 0) reasons.push('worktree-conflicted');
  if (Number(summary?.staged || 0) > 0) reasons.push('staged-changes');
  if (Number(summary?.unstaged || 0) > 0) reasons.push('unstaged-changes');
  if (Number(summary?.untracked || 0) > 0) reasons.push('untracked-changes');
  if (reconciliation?.clean === false && reasons.length === 0) reasons.push('worktree-dirty');
  if (reasons.length) return { risk: 'possible', reasons };
  const op = String(policy.operationClass || '').toLowerCase();
  if (['read', 'read_only', 'readonly', 'inspect', 'search', 'query'].includes(op)) {
    return { risk: 'none', reasons: ['read-only-policy'] };
  }
  if (['write', 'mutate', 'deploy', 'commit', 'push', 'delete'].includes(op)) {
    return { risk: 'possible', reasons: ['write-capable-policy'] };
  }

  if (!reconciliation?.ok) return { risk: 'unknown', reasons: ['reconciliation-unavailable'] };
  if (reconciliation.aheadOrDiverged) return { risk: 'possible', reasons: ['local-remote-diverged'] };
  return { risk: 'unknown', reasons: ['clean-state-operation-unknown'] };
}

export function isFreshCheckpoint(reconciliation) {
  return Boolean(
    reconciliation?.ok &&
    reconciliation.clean &&
    reconciliation.head &&
    reconciliation.remoteHead &&
    reconciliation.remoteHeadFresh !== false &&
    reconciliation.head === reconciliation.remoteHead
  );
}

function changed(before, after) {
  return Boolean(before && after && before !== after);
}
