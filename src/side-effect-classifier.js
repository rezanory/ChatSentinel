export function classifySideEffectRisk({ signal = {}, reconciliation, previous, policy = {} } = {}) {
  if (signal.sideEffectRisk && signal.sideEffectRisk !== 'unknown') {
    return signal.sideEffectRisk;
  }

  if (signal.state === 'RUNNING' || signal.externalActivity) return 'possible';

  const prevR = previous?.reconciliation;
  if (changed(prevR?.remoteHead, reconciliation?.remoteHead)) return 'confirmed';
  if (changed(prevR?.head, reconciliation?.head)) return 'confirmed';

  const op = String(policy.operationClass || '').toLowerCase();
  if (['read', 'read_only', 'readonly', 'inspect', 'search', 'query'].includes(op)) return 'none';
  if (['write', 'mutate', 'deploy', 'commit', 'push', 'delete'].includes(op)) return 'possible';

  if (!reconciliation?.ok) return 'unknown';
  if (!reconciliation.clean || reconciliation.aheadOrDiverged) return 'possible';
  return 'unknown';
}

export function isFreshCheckpoint(reconciliation) {
  return Boolean(
    reconciliation?.ok &&
    reconciliation.clean &&
    reconciliation.head &&
    reconciliation.remoteHead &&
    reconciliation.head === reconciliation.remoteHead
  );
}

function changed(before, after) {
  return Boolean(before && after && before !== after);
}
