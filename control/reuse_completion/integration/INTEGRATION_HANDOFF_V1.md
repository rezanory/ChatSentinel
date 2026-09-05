# Reuse Completion Integration Handoff V1

Status: **GREEN INTEGRATION CANDIDATE — PRE-RELEASE ONLY**

Repository: `rezanory/ChatSentinel`
Worktree: `C:\ChatSentinel`
Branch: `integration/reuse-completion-v1`
Baseline reconciled local=remote: `d7214d334d11f6ea8590aab78f875db35da5a337`
Validated implementation SHA: `b6e65a68d003366e2a49518bc404749671c77a90`
Validated implementation tree: `2128e026e2f99ad05b472f6b98133fe519ff573a`
Date: 2026-09-05

## Exact green candidates serially unioned

| Lane | Exact lane candidate | Integration commit |
|---|---|---|
| C1 session/snapshot restore | `88a0be40279adb4bc3148f5c507b0efc3de4e6ec` | `59e42b0` |
| C3 search/export/import | `82d1052ec64a3bb849daf4625392e2c736144d0a` | `beab08e` |
| C4 audit/history/folders | `22a1a4a2f5c8c65eadf361d41971076bbd59ba8b` | `9ab012d` |
| Chat Control | `46317fabcfe3047fddb603080ea527295496bab5` | `f267cab` |
| Integration Controller | `964b28de914a08023481b7133ce2346f38e3202b` | `645b87b` |
| Reuse research/provenance | `9f25213` | `33f660e` |

Integration syntax-gate coverage was then fixed forward in `b6e65a6` so the standalone Integration Controller and Chat Control component are covered by `npm run check`.
## Component-First integration boundaries

- C1 keeps snapshot storage/restore in standalone components; only `background.js` composition was reconciled with existing crash/runtime recovery.
- C3 keeps search and portable bundle logic standalone; only shared server/console composition was unioned.
- C4 keeps audit history and project tree standalone; only shared server/console composition was unioned.
- Chat Control owns Focus/Reload/Close/Replace policy; the executor is a thin adapter. Integration preserved `replaceFromTabId` prompt-ownership transfer.
- Integration Controller remains standalone under `src/components/integration-controller/`.
- Research lane changes are provenance/docs/licenses only.

## Integration-scope fix-forwards

- C1 shared `background.js` and `package.json` conflicts resolved additively without dropping crash/runtime recovery.
- C3 shared server/test conflict exposed a missing test-block closure; fixed and revalidated.
- C4 shared console/server conflicts were composed additively so C3 search/import/export remained intact.
- Chat Control adapter retained current single-delivery ownership semantics during replacement.
- Syntax gate was extended to cover newly integrated standalone controller modules.

A final aggregate run initially observed one browser-E2E assertion during concurrent validation. Investigation showed another E2E process occupying fixed test port `4318` with a stale test watchdog; after isolation, the complete browser E2E passed. This was recorded as test-environment contention, not suppressed as a product failure.
## Issue #3 acceptance evidence

1. Restart persistence/restore: C1 session restore tests cover browser restart reuse/create behavior and project switching.
2. Automatic snapshots/selective restore: snapshot-store and restore-controller tests cover dedupe, retention, selective restore, failure isolation and safe URL policy.
3. Durable/retryable queue: command-queue lifecycle tests, server command API tests and durable supervisor browser E2E are green.
4. Search/filter: project-search focused tests and integrated search route/UI are green.
5. Export/import: portable-bundle tests and preview-before-apply server integration are green.
6. Audit/history UI + folders: audit-history/project-tree focused tests, server integration and project console composition are green.
7. No critical third-party runtime dependency: security policy reports zero runtime dependencies.
8. Provenance: `THIRD_PARTY_NOTICES.md`, `LICENSES/`, `docs/SOURCE_INVENTORY.md` and `control/reuse_completion/research/PROVENANCE_MANIFEST_V1.json` are updated.
9. Existing recovery/security/E2E: aggregate unit, syntax, policy, browser E2E, production smoke, npm audit and PowerShell parser gates are required on the exact docs-bound SHA before push.

## Release boundary

Issue #3 remains **OPEN**. This handoff does not authorize a `main` merge, Issue #3 closure, Production tag, installer rollout, or production activation. The integration branch may be pushed only after the docs-bound exact SHA passes the complete independent gate set and local/remote candidate heads are reconciled.
## Post-Reload live acceptance fix-forward

A real Chrome reload acceptance was performed against the pushed candidate `1394df4898872d4c480c307c3fa93f4dd354bc0c`.
The MV3 worker woke correctly, claimed commands, and the watchdog/extension channel was healthy. A stale `tabId` Focus command with a valid fallback URL successfully recovered by opening/focusing a replacement tab, but live inspection showed the durable project registry still retained the stale old `tabId`.

This integration-scope defect was fixed in `cf1d908d4d32077b7c80219a4e01db4aed5ca160` by adding standalone `ChatSentinelChatMembershipRepair` and thin executor composition. After a stale Focus fallback succeeds, the stable conversation membership is reattached to the recovered tab, lane/branch attribution is preserved, project grouping is refreshed best-effort, and retry idempotency continues to use the existing Chat Control progress marker.

Validation before documentation binding:
- focused Chat Control + membership repair: 8/8 PASS;
- aggregate unit suite: 120/120 PASS;
- syntax/check: PASS;
- security policy: PASS, zero runtime dependencies;
- browser E2E: PASS;
- production smoke: PASS;
- npm audit: 0 vulnerabilities;
- PowerShell parser suite: 6/6 PASS;
- diff-check: PASS.

The exact docs-bound SHA after this evidence update must still pass the same complete gate set before push/freeze. Issue #3 remains OPEN until the final live reload acceptance of this fix is observed.

## Final E2E harness stabilization

A Chrome registration timing flake was eliminated in test scope by `d3b624e5a279bd1ddc4ef6bdb48048bcca515d15`: Project Console tab A/B discovery now uses the existing bounded worker wait instead of an immediate one-shot query. Two consecutive isolated browser E2E executions completed fully green after the change. No production runtime behavior was altered by this commit.

## Final live acceptance and release version

After the user reloaded the pushed `438f1b4a633021f92192a4a96dda84275810eed7` candidate, an isolated temporary-project acceptance completed `LIVE_ACCEPTANCE_PASS`: the MV3 worker claimed the stale Focus command, recovered a replacement tab, returned `staleRecovered:true` and `membershipRepaired:true`, updated the durable registry from the seeded stale tab ID to the new live tab ID, then closed the temporary tab and removed the temporary project.

The release line is v1.2, so active release surfaces were normalized from `1.1.1` to `1.2.0`: package metadata, Chrome manifest, watchdog runtime version, installer target, production smoke expectation, and browser E2E expectation. No active package/extension/src/scripts release surface retains `1.1.1`.

The v1.2.0 version-normalized candidate passed 120/120 unit tests, syntax/check, security policy, complete browser E2E, production smoke, npm audit with zero vulnerabilities, all six PowerShell parser checks, and diff-check. `main`, Issue #3 state, and Production tags remain protected until explicit promotion.
