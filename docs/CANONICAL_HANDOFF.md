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
