# Validation — ChatSentinel v0.1

## Executed baseline checks

A clean local reconstruction of the repository core was executed with Node.js 22.16.0.

Results:

- Recovery policy tests: **7/7 PASS**
- `node --check` on recovery engine: PASS
- `node --check` on local watchdog baseline: PASS
- `node --check` on Chrome content script: PASS
- `node --check` on Chrome background worker: PASS
- `node --check` on project reconciler: PASS
- `node --check` on heartbeat emitter: PASS

## Covered recovery behavior

- active work -> WAIT
- idempotent Retry -> SAFE_RETRY
- unknown Retry state -> ESCALATE
- possible side effects + checkpoint -> CONTINUE_SAME_CHAT
- dead conversation -> CONTINUE_NEW_CHAT
- frozen UI -> RELOAD_AND_RECHECK
- interrupted stream + checkpoint -> CONTINUE_SAME_CHAT

## Not yet accepted

Live ChatGPT DOM/fault injection is not yet complete. Automated Continue/New Chat actions remain intentionally disabled until the GitHub/project reconciliation path is validated against real projects.

## v0.2 runtime smoke validation

Validated on Windows with Node.js 22.16.0 against the real local checkout `C:\ChatSentinel`.

- `npm test`: **7/7 PASS**
- `npm run check`: PASS including guarded actuator
- `/health`: PASS
- `/supervisor`: PASS
- project registration + Git reconciliation: PASS
- local HEAD == remote HEAD: `991533e13431d548cca9a12c50e06e05dce6eff3`
- simulated Retry with possible side effects + fresh checkpoint: correctly chose `CONTINUE_SAME_CHAT`
- automatic UI recovery remains opt-in through `autoRecoveryEnabled`; advisory mode is the default

Watchgoose check `chatsentinel` was provisioned with 120s timeout + 60s grace. The runtime heartbeat URL remains environment-configured rather than committed.
