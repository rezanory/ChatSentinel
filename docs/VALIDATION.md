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
