# Response Completion Recovery component

Responsibility: recover a ChatGPT response that stopped with Connection interrupted. Waiting for the complete answer (or equivalent generation errors) and drive the same conversation to a complete final answer without repeating already-completed side effects.

## Public contract

globalThis.ChatSentinelResponseCompletion exposes:
- inspect(document) — distinguish an active interruption from historical error text, including banners rendered outside message turns.
- uildContinuationPrompt(context) — require exact continuation and complete final delivery, with durable Git/checkpoint reconciliation when available.
- isStreamInterruptionDecision(decision) — scope the specialized actuator path to stream interruptions only.
- prepareAttempt(...) / markAttempt(...) — incident-scoped cooldown/deduplication so one error marker cannot emit repeated continuation prompts.

## Safety invariants

- Historical interruption text must not trigger recovery after a later user or completed assistant turn.
- An active interruption is recovered in the same chat rather than entering a reload loop.
- Continuation must not restart or repeat already-delivered text.
- Tool/Git/file/browser/external side effects must be reconciled before unfinished work resumes.
- One active incident emits at most one continuation attempt during the cooldown; a genuinely new interruption can be recovered independently.
- Dead-conversation, SAFE_RETRY, ordinary continuation, and other existing recovery policies remain separate.

## Reuse / ownership boundary

This component reuses the existing content signal path, recovery engine, actuator, Git reconciliation, identity migration, and browser injection substrates. It adds no runtime dependency and no third-party service.

It owns interruption detection, complete-answer continuation semantics, and incident deduplication only. It does not own generic chat control, durable queue execution, project orchestration, Git mutation, or Production release authority.
