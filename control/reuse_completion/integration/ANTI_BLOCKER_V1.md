# Reuse Completion Integration Anti-Blocker V1

Date: 2026-09-05
Branch: `integration/reuse-completion-v1`
Implementation checkpoint: `b6e65a68d003366e2a49518bc404749671c77a90`

## Resolved integration blockers

- C1/C3/C4 shared composition conflicts were fixed forward without replacing standalone component ownership.
- C3 integration-test syntax boundary was repaired and focused regression returned green.
- Chat Control replacement preserves old-tab prompt ownership transfer before optional close.
- New standalone Integration Controller and Chat Control files are explicitly covered by the syntax gate.
- Research provenance conflicts were resolved additively; existing LightSession attribution and new pinned MIT notices coexist.

## Validation anti-blocker

Browser E2E uses fixed test port `4318`. A concurrent validation process can temporarily occupy that port and make a fresh run see the wrong test watchdog or shared test state. One aggregate run showed this contention; a subsequent isolated run completed the entire browser E2E green. Candidate freeze therefore requires an isolated final browser E2E execution with no competing `4318` listener.

## Protected boundaries

- `main` is untouched by this lane.
- Issue #3 stays OPEN.
- No Production tag or production activation is allowed here.
- Exact lane candidates, not moving branch tips, are the integration inputs.
- If any docs-bound independent gate fails, do not describe or push that HEAD as the green integration candidate.
## Live stale-tab membership blocker — resolved in integration scope

Post-Reload live acceptance proved the MV3 worker and durable command channel were active, but exposed one stale-focus lifecycle gap: URL fallback could recover a missing tab while leaving the project registry bound to the old `tabId`. Repeated Focus could therefore create another replacement.

Fix-forward: `cf1d908d4d32077b7c80219a4e01db4aed5ca160` adds a standalone membership-repair component. It reattaches the stable conversation to the recovered tab after successful stale Focus and preserves existing lane metadata. The pre-fix live registry was repaired once manually to prevent additional duplicate recovery during validation.

Release anti-blocker: the extension must be Reloaded once after this fix is pushed, then a live stale-focus acceptance must show `membershipRepaired: true` and the registry `tabId` must equal the recovered tab. Until that exact observation, do not close Issue #3 or call the project Production Ready.

## E2E tab-registration timing flake — resolved

The final docs-bound validation exposed Chrome test-harness timing where `openPage` succeeded but an immediate `chrome.tabs.query()` occasionally could not yet see project-console tab A/B. This is not a runtime product failure; the harness now uses bounded `waitWorkerValue` registration waits in `d3b624e5a279bd1ddc4ef6bdb48048bcca515d15`. Two consecutive isolated full browser E2E runs passed after this change.
