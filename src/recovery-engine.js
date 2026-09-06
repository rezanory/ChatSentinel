export const Action = Object.freeze({
  WAIT: 'WAIT',
  SAFE_RETRY: 'SAFE_RETRY',
  RETRY_MESSAGE_DELIVERY: 'RETRY_MESSAGE_DELIVERY',
  CONTINUE_SAME_CHAT: 'CONTINUE_SAME_CHAT',
  RELOAD_AND_RECHECK: 'RELOAD_AND_RECHECK',
  CONTINUE_NEW_CHAT: 'CONTINUE_NEW_CHAT',
  ESCALATE: 'ESCALATE'
});

export function decideRecovery(input = {}) {
  const {
    state = 'UNKNOWN',
    retryVisible = false,
    messageDeliveryTimedOut = false,
    messageDeliveryRetryCount = 0,
    connectionInterrupted = false,
    conversationDead = false,
    uiFrozen = false,
    genericUiFailure = false,
    pageCrashed = false,
    progressAgeMs = 0,
    sideEffectRisk = 'unknown',
    checkpointFresh = false,
    externalActivity = false,
    retryCount = 0
  } = input;

  if (conversationDead) {
    return decision(Action.CONTINUE_NEW_CHAT, 'conversation-dead', 0.98);
  }

  if (state === 'RUNNING' || externalActivity) {
    return decision(Action.WAIT, 'execution-still-active', 0.93);
  }

  if (messageDeliveryTimedOut) {
    if (Number(messageDeliveryRetryCount || 0) < 2) {
      return decision(Action.RETRY_MESSAGE_DELIVERY, 'message-delivery-timeout-native-retry', 0.97);
    }
    return decision(Action.ESCALATE, 'message-delivery-timeout-retry-budget-exhausted', 0.95);
  }

  if (connectionInterrupted) {
    return checkpointFresh
      ? decision(Action.CONTINUE_SAME_CHAT, 'stream-interrupted-complete-answer-checkpoint-known', 0.96)
      : decision(Action.CONTINUE_SAME_CHAT, 'stream-interrupted-complete-answer-reconcile-required', 0.92);
  }

  if (pageCrashed) {
    return decision(Action.RELOAD_AND_RECHECK, 'page-crash-content-detected', 0.97);
  }

  if (uiFrozen && progressAgeMs >= 180000) {
    return decision(Action.RELOAD_AND_RECHECK, 'ui-frozen-no-progress', 0.9);
  }

  if (retryVisible) {
    if (sideEffectRisk === 'none' && retryCount < 2) {
      return decision(Action.SAFE_RETRY, 'retry-visible-idempotent', 0.92);
    }
    if (checkpointFresh) {
      return decision(Action.CONTINUE_SAME_CHAT, 'retry-visible-side-effects-possible', 0.91);
    }
    return decision(Action.ESCALATE, 'retry-visible-state-uncertain', 0.86);
  }

  if (genericUiFailure) {
    return checkpointFresh
      ? decision(Action.CONTINUE_SAME_CHAT, 'generic-ui-failure-checkpoint-known', 0.88)
      : decision(Action.RELOAD_AND_RECHECK, 'generic-ui-failure-state-uncertain', 0.84);
  }

  if (progressAgeMs >= 300000) {
    return checkpointFresh
      ? decision(Action.CONTINUE_SAME_CHAT, 'stalled-checkpoint-known', 0.8)
      : decision(Action.RELOAD_AND_RECHECK, 'stalled-state-uncertain', 0.75);
  }

  return decision(Action.WAIT, 'no-recovery-needed', 0.7);
}

function decision(action, reason, confidence) {
  return { action, reason, confidence };
}
