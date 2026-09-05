# Canonical Handoff — ChatSentinel v1.1.0

Status: **PRODUCTION CANDIDATE / PRE-RELEASE GATES PASS**

Repository: `rezanory/ChatSentinel`
Local path: `C:\ChatSentinel`
Working branch: `feature/v1.1.0-project-console`
Target branch: `main`
Previous production release: `v1.0.0` at `b792014f82b9f101016879981a128fced0130bc7`

## User-defined Production-ready scope

v1.1 is not accepted merely because the watchdog recovers one conversation. Production-ready requires:

- multiple projects supervised simultaneously;
- multiple parallel ChatGPT chats per project;
- native browser grouping for parallel project chats;
- extension controls/settings displayed inside the active ChatGPT page rather than a popup/side panel;
- per-project local path/policy/auto-recovery/grouping settings;
- project chat list with live recovery state and focus/open controls;
- existing retry/hang/interruption/dead-chat recovery safety retained.

## Implemented architecture

`Project → Parallel Chats → Sessions/Recovery Decisions` is durable server state. Each ChatGPT tab signals independently. Stable conversation evidence is preferred; root-route chats safely use `tab:<id>` until a stable identity becomes available. Membership then migrates automatically.

The Chrome action has no popup. `project-console.js` renders a resizable Shadow DOM console in the active ChatGPT page. `background.js` uses native Chrome `tabs`, `tabGroups` and `scripting` APIs to focus/open/group parallel chats and inject the console into pre-existing tabs after extension reload.

Legacy v1 projectPath configs migrate to v1.1 Projects. The global auto-recovery master and per-project auto-recovery flag must both be enabled before automatic browser actuation.

## Reuse/provenance decisions

Plugin-first/source-reuse gate was run before completing v1.1:

- `Sami21234/Chatgpt-Sidebar` (MIT): in-page docking/resizing pattern adapted into Shadow DOM.
- `GoogleChrome/chrome-extensions-samples` (Apache-2.0): native `tabs.group` + `tabGroups.update` grouping pattern adapted.
- `glyndavidson/chatgpt-folders` (MIT): folder/project UX reference only.
- `nathabee/chatgpt-organizer` (MIT): Projects/Settings IA reference only; its separate `sidePanel` surface rejected for this product requirement.

Full notices: `THIRD_PARTY_NOTICES.md`, `LICENSES/`, `docs/SOURCE_INVENTORY.md`.

## Current validation

Pre-commit release gate passes 32/32 tests, all browser recovery/identity E2E, in-page project-console acceptance, native Chrome Tab Group acceptance, production restart/persistence smoke, security policy, JS/PowerShell parsing, and npm audit with 0 vulnerabilities. Details: `docs/VALIDATION.md`.

## Exact validated implementation candidate

- SHA: `638cb036a0df80df8f290a99d45cd163dd16b8b3`
- Tree: `4207d61d3ea156b4d502f8a157dc72c98da743ca`
- local candidate HEAD = remote candidate HEAD: PASS
- clean working tree: PASS
- `npm run release-validate` on exact candidate: PASS
- PowerShell parser suite on exact candidate: PASS

This handoff update is documentation-only relative to the accepted implementation candidate.

## Exact next action

Commit/push this evidence binding → validate the docs-bound clean SHA → fast-forward `main` → validate exact main → run upgrade-aware Windows installer → deliberate self-restart test → reload unpacked extension once in Default Chrome profile → live in-page/multi-project acceptance → tag/release `v1.1.0`.

## v1.2 Reuse Completion — O1 Orchestrator checkpoint

O1 authoritative lane is green on `feat/project-orchestrator-v1` from baseline `080909f8fd691b8e043b6b3083e131a159749a98`.

Implementation candidate: `fdcfb5ae2a09809052c20f26c311d1b655582309` (tree `63ceb6428119f527c214d9e2111258d63c23960e`). It adds a Component-First Autonomous Project Orchestrator that detects lane completion, decides `NEXT/FIX/REPLACE/INTEGRATE`, and materializes actions through the existing Durable Command Queue/extension executor. Full O1 evidence and exact next action: `control/reuse_completion/orchestrator/O1_HANDOFF.md`.

Issue #3 remains OPEN. This checkpoint does **not** authorize Production tagging, main merge, or self-certification of independent gates.

## v1.2 Live Lifecycle / Tab Cleanup Checkpoint - 2026-09-05

Verified completed lane tabs are disposable execution surfaces: O1/CCTL/R/C4/ICTL were reconciled against Git/handoffs, closed through durable CLOSE_CHAT, and stale project registrations were removed. Incomplete C1/C3 and the current/integration chat remain protected from cleanup.

A live anti-stall bug was found after cleanup: missing C1/C3 chats could not be recreated because CREATE_LANE_CHAT used a permanent idempotency key from an earlier successful generation. The Project Orchestrator component now advances a deterministic createGeneration from succeeded create history so later missing chats receive a new idempotency key. Full integration gates remain mandatory.

The project-level recovery follow-up for Connection interrupted. Waiting for the complete answer remains tracked separately in the ICTL handoff; implementation is still pending and must preserve continuation through delivery of the complete answer.

## v1.2 Reuse Completion — Integration Candidate Checkpoint — 2026-09-05

The reuse-completion integration lane reconciled from `d7214d334d11f6ea8590aab78f875db35da5a337` and serially unioned only exact green candidates for C1 session restore, C3 search/export/import, C4 audit/history/folders, standalone Chat Control, standalone Integration Controller, and the reuse research/provenance lane. Component-First ownership was preserved; shared conflicts were resolved only at composition boundaries.

Validated implementation checkpoint before this documentation binding: `b6e65a68d003366e2a49518bc404749671c77a90` (tree `2128e026e2f99ad05b472f6b98133fe519ff573a`). Exact candidate mapping, integration fix-forwards and Issue #3 evidence are recorded in `control/reuse_completion/integration/INTEGRATION_HANDOFF_V1.md`; validation contention and release protections are recorded in `control/reuse_completion/integration/ANTI_BLOCKER_V1.md`.

Issue #3 acceptance surfaces are now represented in the integration candidate: browser-restart project session restore; automatic snapshots and selective restore; durable/retryable command queue; project/chat search and filters; preview-before-apply configuration/recovery export-import; audit/history and nested folders; zero critical third-party runtime dependency; and updated license/provenance evidence. The exact docs-bound SHA must still pass the complete independent gate set before the integration branch is pushed as green.

The earlier lifecycle-checkpoint sentence saying the `Connection interrupted. Waiting for the complete answer` recovery follow-up was still pending is superseded. Response-completion recovery and message-delivery-timeout recovery were already integrated before this lane and their focused/unit/browser E2E continuations are green in the current candidate; they remain distinct from browser renderer/tab-crash recovery.

Issue #3 remains **OPEN**. No `main` merge, Issue #3 closure, Production tag, installer rollout, or production activation is authorized by this checkpoint.

## v1.2 Post-Reload stale-focus membership checkpoint — 2026-09-05

Live acceptance after reloading ChatSentinel 1.1.1 confirmed the MV3 service worker wakes and claims durable commands. It also exposed one final integration lifecycle gap: stale Focus URL fallback recovered a replacement tab but did not migrate the durable project membership from the old `tabId`.

Integration fix `cf1d908d4d32077b7c80219a4e01db4aed5ca160` adds standalone stale-focus membership repair and preserves Component-First Chat Control boundaries. Pre-doc validation is fully green at 120/120 unit tests plus syntax, policy, browser E2E, production smoke, zero-vulnerability audit, PowerShell parser and diff checks.

This supersedes any claim that the prior pushed integration SHA alone was ready for release. One final extension Reload plus live registry-migration acceptance is still required after the new docs-bound green SHA is pushed. Issue #3 remains OPEN; no main merge or Production tag is authorized yet.

Final validation also hardened the browser E2E harness against Chrome tab-registration timing: `d3b624e5a279bd1ddc4ef6bdb48048bcca515d15` replaces immediate Project Console tab A/B queries with bounded registration waits. Two consecutive isolated browser E2E runs passed after this test-only stabilization; runtime product behavior is unchanged.

## v1.2.0 Release Version Binding — 2026-09-05

Post-reload isolated live acceptance of the stale-focus membership-repair path passed end-to-end using only a temporary project/tab and cleaned up afterward. The v1.2 reuse-completion release surfaces are now versioned `1.2.0` instead of the legacy `1.1.1` label. Full independent gates on the version-normalized candidate are green; formal `main` promotion, Issue #3 closure and Production tagging remain separate protected actions.

## v1.2 Active Parallel Chats lifecycle correction

Live UI review found that Project counts and Parallel Chats reflected raw attached conversation membership rather than active work. This is superseded by `a2c78497a87fc6d4c3fbab4dc194905b30e6596f`: Active Parallel Chats now use real tab/activity and fresh lifecycle evidence, terminal/stale rows are excluded from the active projection, and stable memberships detach on actual tab close. Historical/raw state is not destructively erased by the projection.

Pre-handoff gates are fully green: 125/125 unit, syntax, policy, browser E2E (including completed-live-tab exclusion and stable closed-tab cleanup), production smoke, npm audit 0 vulnerabilities, PowerShell parser 6/6 and diff-check.

## v1.2.1 Verified Prompt Delivery hotfix — 2026-09-05

Live browser evidence showed CREATE_LANE_CHAT could report `promptSent=true` while the prompt was serialized into `?prompt-textarea=...` and no ChatGPT user turn existed. Hotfix implementation `0a5b2dec09b1beb281ec4a857b2c4e3edee22b55` adds an explicit prompt-delivery component and requires independent post-click evidence before durable success.

The browser regression fixture now contains a deliberate GET-form submit trap; the full pre-doc gate is green at 129/129 unit tests plus syntax, security policy, browser E2E (including URL-contamination rejection), production smoke, zero-vulnerability audit, PowerShell parsing and diff-check. Baseline v1.2.0 remains immutable; promotion to stable requires the same gate set on the docs-bound SHA.
