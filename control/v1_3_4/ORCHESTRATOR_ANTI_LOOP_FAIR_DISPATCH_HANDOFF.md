# ChatSentinel v1.3.4 — Orchestrator Anti-Loop / Fair-Dispatch Handoff

Date: 2026-09-06
Branch: `fix/v1.3.4-orchestrator-anti-loop-fair-dispatch`
Baseline: `75bb61fff81cb54eed574da1c1fdf9ab58b2dff6` (v1.3.3 continuation tip)

## Incident

Live orchestration repeatedly returned the same terminal `SEND_PROMPT` FIX command (`cmd:fa9305b2-8d6d-4901-8afd-7b77afef6803`) for PH8 C18. The command itself had succeeded, but the lane session remained stale. The FIX idempotency key was derived from `session.updatedAt`, so the next tick deduplicated to the same terminal command and `fixAttempts` never advanced. Project action selection also chose only the first actionable lane, allowing that lane to starve independent `CREATE_LANE_CHAT` work.

A secondary attribution defect was confirmed: newly created lane chats retained the project-root `projectPath`, while their exact lane `branch` was stored separately. Recovery reconciled the project root and therefore reported a generic branch such as `fix/ph7-p01-outer-qa-drift-v1` instead of the C15/C19V worktree branch.

## Fix-forward

- Component-First fair dispatcher materializes multiple independent lane actions per tick up to bounded `maxParallelLanes` capacity.
- Priority is `NEXT` before `REPLACE` before `FIX`; blocked lanes no longer suppress independent admissible work.
- FIX and REPLACE idempotency keys now advance from terminal command-history generations instead of stale session timestamps.
- FIX and REPLACE budgets are bounded; exhausted lanes become deterministic `BLOCKED` rather than looping.
- Durable queue retry exhaustion is terminally marked failed/quarantined before another claim can revive it.
- Lane `worktreePath` is propagated orchestrator → command → extension attach/membership repair → server config.
- Heartbeat/recovery reconciliation prefers the lane worktree and backfills missing `worktreePath` from the active orchestrator lane contract for already-created chats.

## Validation

Pre-freeze Windows validation is green:

- focused orchestrator regression: 13/13 PASS
- focused durable queue regression: 6/6 PASS
- server integration including explicit lane-worktree attribution and legacy-config backfill: 13/13 PASS
- full Node suite: 233/233 PASS
- version consistency: PASS (`1.3.4`)
- syntax/check: PASS
- security policy: PASS, zero runtime dependencies
- shell parser: PASS
- browser extension E2E: PASS, including durable `CREATE_LANE_CHAT` and supervisor idempotency
- production smoke: PASS
- `npm audit --omit=dev`: 0 vulnerabilities
- `git diff --check`: PASS

The running watchdog observed during the incident predates this source and must be deliberately restarted after the exact candidate is pushed. Live acceptance is not complete until `/health` reports `1.3.4`, the project heartbeat shows lane-specific worktree branches for existing/new lanes, and a stalled FIX lane no longer prevents independent lane creation.
