# ChatSentinel Architecture v0.1

## Runtime flow

1. Browser Sentinel observes ChatGPT DOM state.
2. Signals are normalized and sent to the local watchdog on `127.0.0.1:4317`.
3. The Recovery Engine classifies the safest action.
4. Destructive or duplicate-prone UI actions remain blocked until project reconciliation is available.
5. The watchdog stores per-conversation state and exposes `/health` and `/sessions`.

## Current fault states

- connection interrupted
- retry visible
- conversation unavailable/dead
- UI frozen / no mutation
- active generation
- long no-progress state

## Recovery invariants

- Never blind-retry when side effects may have occurred.
- Active external work wins over UI inactivity: `WAIT`.
- Dead conversations migrate to a new chat.
- Uncertain state prefers recheck/escalation over duplicate execution.
- Fresh canonical checkpoints allow continuation without replay.

## Next adapters

- GitHub canonical handoff reconciler
- Watchgoose heartbeat emitter
- Remote Desktop Commander process restarter
- Make/aictrl optional orchestration hooks
- New-chat handoff generator and controlled browser actuator
