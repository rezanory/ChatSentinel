# Canonical Handoff — ChatSentinel

Status: ACTIVE

Repository: `rezanory/ChatSentinel`
Local target: `C:\ChatSentinel`

## Implemented

- zero-dependency Node.js core
- deterministic recovery engine
- local watchdog HTTP service
- Chrome Manifest V3 extension
- ChatGPT DOM signal detector
- extension-to-watchdog bridge
- fail-safe recovery tests

## Safety policy

`Retry` is never auto-executed solely because a Retry button exists. Side-effect risk and checkpoint state must be known first.

## Current automatic action surface

Only `RELOAD_AND_RECHECK` is allowed to execute automatically in browser v0.1. Retry/continue/new-chat decisions are advisory until reconciliation and idempotency adapters are complete.

## Next critical path

1. GitHub reconciler / project registry.
2. Controlled continuation and new-chat handoff actuator.
3. Watchgoose heartbeat.
4. Local process supervision / restart integration.
5. Fault injection against a live ChatGPT tab.

Older handoffs are superseded by the latest non-superseded version of this file.
