# ChatSentinel

**ChatSentinel v1.1.0** is a local-first watchdog and multi-project control console for long-running ChatGPT development work. It detects interrupted/frozen/dead conversations, reconciles external project state, supervises parallel chats and chooses the safest recovery path instead of blindly pressing Retry.

## What v1.1 adds

- Multiple independent projects can run at the same time.
- Each project can own multiple parallel ChatGPT chats.
- Parallel chats can be placed in a real Chrome Tab Group named after the project.
- Clicking the extension icon opens ChatSentinel **inside the active ChatGPT page**; there is no popup/side-panel workflow.
- Project name, local path, recovery policy, per-project auto-recovery and tab-group settings live in that in-page console.
- The console lists each project chat with live state/decision/risk/checkpoint status and can focus/open it.
- New project chats inherit project membership automatically.
- Root-route ChatGPT conversations are resolved without relying only on `/c/<id>`; safe `tab:<id>` fallback is available.

## Recovery actions

- `WAIT` — execution still appears active.
- `SAFE_RETRY` — only for explicitly read-only/idempotent work.
- `CONTINUE_SAME_CHAT` — checkpoint-aware continuation.
- `RELOAD_AND_RECHECK` — recover UI/stream state without repeating project work.
- `CONTINUE_NEW_CHAT` — move to a new conversation with generated handoff.
- `ESCALATE` — insufficient evidence for an automatic action.

## Safety invariants

1. A visible Retry button is never sufficient evidence for Retry.
2. A Git checkpoint is fresh only when the tree is clean and local HEAD equals remote HEAD.
3. Active work is never interrupted only because the page has been quiet.
4. Automatic browser actuation requires the global master switch **and** the selected project's auto-recovery switch.
5. Unknown side-effect state fails closed.
6. Git/source-of-truth overrides stale conversation assumptions.
7. Project state is isolated: a chat can be attached to one ChatSentinel project at a time.

## Architecture

- `extension/identity.js` — robust ChatGPT conversation identity with tab fallback.
- `extension/project-console.js` — Shadow DOM console rendered inside ChatGPT.
- `extension/background.js` — project APIs, tab focus/new-chat control and Chrome Tab Groups.
- `extension/content.js` — failure/liveness detector.
- `extension/actuator.js` — guarded Retry/Continue/New Chat actions.
- `src/recovery-engine.js` — deterministic recovery policy.
- `src/side-effect-classifier.js` — project-aware side-effect classification.
- `src/project-reconciler.js` — local/remote Git reconciliation.
- `src/server.js` — secured localhost multi-project watchdog API.
- `src/state-store.js` — durable project/chat/session state with v1 migration.
- `scripts/run-watchdog.ps1` — self-restarting Windows supervisor.

## Windows installation

```powershell
cd C:\ChatSentinel
npm run release-validate
powershell -ExecutionPolicy Bypass -File .\scripts\install-autostart.ps1
```

The service binds only to `127.0.0.1:4317`. Production state/logs live outside the repository in `%LOCALAPPDATA%\ChatSentinel`.

Load `C:\ChatSentinel\extension` from `chrome://extensions` once. The stable extension ID is:

`pcidbmcahljjpbmaecjmfmpbpfnpoepc`

For an unpacked extension update, click its Chrome **Reload** icon once. After v1.1, clicking the ChatSentinel toolbar icon toggles the console in the current ChatGPT page. If that page predates the extension reload, ChatSentinel uses the `scripting` permission to inject the console without requiring a page refresh.

## Multi-project workflow

1. Open any ChatGPT tab and click the ChatSentinel toolbar icon.
2. Create/select a project in the in-page console and set its local Git path.
3. Attach the current chat.
4. Use **New project chat** for parallel lanes; new tabs inherit project membership.
5. Use **Group open tabs** to create/update the Chrome Tab Group for the project.
6. Use the project chat list to switch between lanes and see live watchdog decisions.

Legacy v1 conversation→path mappings are migrated automatically into v1.1 projects on first state load.

## Production validation

`npm run release-validate` runs unit/integration tests, syntax checks, security policy checks, isolated Chromium E2E, in-page project-console tests, real Chrome Tab Group tests, process restart/persistence smoke tests and `npm audit`.

## Privacy

The content script reads page text locally only to recognize known error states. The localhost watchdog receives normalized liveness/error/project metadata, not the ChatGPT conversation body. Project data stays under `%LOCALAPPDATA%\ChatSentinel` unless an explicitly configured external heartbeat is used.

## Third-party provenance

v1.1 adapts small permissively licensed patterns from `Sami21234/Chatgpt-Sidebar` (MIT) for in-page resizing/docking and `GoogleChrome/chrome-extensions-samples` (Apache-2.0) for Chrome Tab Groups. `glyndavidson/chatgpt-folders` and `nathabee/chatgpt-organizer` are reference-only. Full notices are in `THIRD_PARTY_NOTICES.md`, `LICENSES/` and `docs/SOURCE_INVENTORY.md`.

ChatSentinel has **zero npm runtime dependencies and zero npm development dependencies**.

See `docs/PRODUCTION_READINESS.md`, `docs/THREAT_MODEL.md`, `docs/PLUGIN_INTEGRATIONS.md`, `docs/VALIDATION.md` and `docs/CANONICAL_HANDOFF.md`.
