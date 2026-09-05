# ChatSentinel v1.3 Full Project Mode Activation Handoff V1

Status: **GREEN IMPLEMENTATION CANDIDATE — EXACT HANDOFF-BOUND VALIDATION REQUIRED**

Repository: `rezanory/ChatSentinel`
Worktree: `C:\ChatSentinel-worktrees\v13-fullmode`
Branch: `fix/v13-full-project-mode-activation`
Exact baseline SHA: `07a0bfb475c164fde4d6d578f7556bd1b2aed7f6`
Implementation SHA before handoff binding: `9129efa9079f413c220cb2284f7fad6187ebe9f5`
Implementation tree: `c59649afafd6037291295040adf0ebe24ee51a02`
Version: `1.3.0`
Date: 2026-09-05

## Delivered activation boundary

- Added a standalone Full Project Mode activation component on both server and extension sides; existing project, recovery, session, grouping and orchestration authorities are reused rather than duplicated.
- One click now resolves the currently attached project first, then an explicit project selection, then an exact normalized local project-path match; a valid unmatched project path creates a deterministic project identity.
- Ambiguous state fails closed with `project-selection-required`; Full Mode never attaches the chat to an arbitrary first project.
- Successful activation attaches the current ChatGPT chat, enables project auto-recovery and tab grouping, persists the canonical `full` capability profile, groups live project tabs and captures an activation snapshot through the existing snapshot/restore substrate.
- Existing composer text is preserved. The canonical `CHATSENTINEL FULL PROJECT MODE` phrase is prepended only after activation succeeds, is idempotent, and the control never auto-sends the user's prompt.

## Deterministic orchestration activation path

Full Mode records a deterministic descriptor for the existing project-orchestrator authority:

- configure: local-process `POST /orchestrator/configure`
- tick: local-process `POST /orchestrator/tick`
- lane command: durable `CREATE_LANE_CHAT`
- lane contract: `laneId`, `branch`, `baselineSha`, `prompt`
- independent lanes only when canonical `componentFirst` and `parallelLanes` are both enabled
- Integration Controller remains the serialized integration authority

The extension does not acquire local-process orchestration authority and does not create a second runner, queue, mutation or integration authority. `runnerOnDemand`, DOM compaction, snapshots/selective restore, history/search/export/import, recovery and Integration Controller ownership remain with their existing components.

## Focused validation before handoff binding

- Full Mode focused/server/browser-controller regression: PASS.
- Aggregate Node unit/integration suite: **154/154 PASS**.
- Syntax/check: PASS, including both new Full Mode components.
- Security policy: PASS; 51 production files, zero runtime dependencies, stable extension ID `pcidbmcahljjpbmaecjmfmpbpfnpoepc`.
- Shell parser gate: PASS.
- Version consistency: PASS for `1.3.0`.
- Browser E2E: PASS with exit code 0, including real Full Mode create/attach/profile/group/snapshot activation, prompt preservation/no auto-send, project-authority idempotency, existing crash recovery, DOM compaction, active parallel chat projection and durable `CREATE_LANE_CHAT` behavior.
- Browser E2E watchdog and fixture ports are process-isolated so parallel lanes cannot corrupt this lane's test observations; production defaults are unchanged.
- `git diff --check`: PASS.

## Baseline and runtime preservation

The lane started from and remained descended from exact baseline `07a0bfb475c164fde4d6d578f7556bd1b2aed7f6`. No baseline branch, `main`, release tag or production/stable runtime was mutated. Browser tests use temporary profiles, temporary data directories and isolated test watchdog/fixture processes.

No schema or migration was added. No release activation is part of this lane.

## Exact-candidate requirement

This handoff binds the implementation identity above. The final branch tip containing this handoff must rerun the independent gates before push. The pushed branch tip is the canonical lane candidate; the implementation SHA remains the exact code-change identity for review.

## Post-handoff-bound E2E readiness fix-forward

The first exact handoff-bound E2E revalidation exposed a startup-only MV3 service-worker readiness race before any Full Project Mode step executed. No product assertion or Full Mode behavior failed. The browser harness now boundedly reacquires the current extension service-worker CDP target across suspend/restart and emits worker-state diagnostics only on readiness failure.

E2E harness fix-forward SHA: `5cf8e2293fca6ea0d8265dd7ad62d5c2ee14114a`

After this fix-forward, two consecutive complete browser E2E runs passed, including tab-launch guard, crash recovery, delivery/continuation recovery, DOM compaction, real Full Mode create/attach/profile/group/snapshot activation, active parallel chat projection and durable lane-command ownership. Production extension/runtime behavior is unchanged by this harness-only fix.

Because this handoff file is updated after that fix-forward, the new handoff-bound branch tip must receive one final complete gate run before push/freeze.

## Final browser panel readiness fix-forward

A later exact-candidate E2E run exposed another pre-Full-Mode harness race: the panel toggle request succeeded but the test assumed the first toggle necessarily meant `open=true`. The harness now treats the returned panel state as authoritative and boundedly toggles once more only when the first successful response reports the panel closed. This changes test readiness only; production panel behavior is unchanged.

Panel readiness harness fix-forward SHA: `3e6ff8f440629fb22568f213ca98e560c41873f6`

The complete browser E2E passed after this fix, including the real Full Project Mode activation path. The handoff-bound tip containing this note requires the final complete gate run before push.
