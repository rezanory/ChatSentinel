# ChatSentinel

**ChatSentinel v1.0.0** is a local-first watchdog and recovery controller for long-running ChatGPT project work. It detects interrupted/frozen/dead conversations, reconciles project state, and chooses the safest recovery path instead of blindly pressing Retry.

## Production recovery actions

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
4. Browser actuation is opt-in; advisory mode is the default.
5. Unknown side-effect state fails closed.
6. Git/source-of-truth overrides stale conversation assumptions.

## Architecture

- `extension/` — Chrome MV3 detector, guarded actuator and supervisor popup.
- `src/recovery-engine.js` — deterministic recovery policy.
- `src/side-effect-classifier.js` — project-aware side-effect classification.
- `src/project-reconciler.js` — local/remote Git reconciliation.
- `src/server.js` — secured localhost watchdog API.
- `src/state-store.js` — durable atomic state with TTL/caps/corruption recovery.
- `src/logger.js` — structured rotating JSONL audit log.
- `scripts/run-watchdog.ps1` — self-restarting Windows supervisor.

## Windows installation

```powershell
cd C:\ChatSentinel
npm run release-validate
powershell -ExecutionPolicy Bypass -File .\scripts\install-autostart.ps1
```

The service binds only to `127.0.0.1:4317`. Production state/logs live outside the repository in `%LOCALAPPDATA%\ChatSentinel`.

Load `C:\ChatSentinel\extension` once from `chrome://extensions` → **Developer mode** → **Load unpacked**. The committed public extension key gives a stable extension ID:

`pcidbmcahljjpbmaecjmfmpbpfnpoepc`

If Chrome is reinstalled/profile-migrated and pairing must be deliberately reset:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\reset-extension-pairing.ps1
```

## Project registration

Open a saved ChatGPT conversation, click the ChatSentinel extension, and register the local project path. Choose `Read-only` only if repeating the current operation is truly safe. For development/write work, use the conservative/default or write policy.

Conversation→project/policy mapping is stored in Chrome storage and is re-sent after watchdog restart. Server configuration is also persisted locally.

## Production validation

```powershell
npm run release-validate
```

This runs unit/integration tests, syntax checks, production security policy checks, real extension E2E fault injection, process restart/persistence smoke tests, and `npm audit`.

## Privacy

The browser script reads page text locally only to recognize known error states. It sends normalized status/timing/URL/conversation identifiers to the localhost watchdog; it does not send the ChatGPT conversation body to the watchdog or external monitoring services.

## Watchgoose

External heartbeat is optional. Set `CHATSENTINEL_HEARTBEAT_URL` only to the **real private Ping URL** from the Watchgoose check. Do not construct it from the public slug. Local self-restart works without Watchgoose.

## Third-party source policy

No source code from `xcanwin/KeepChatGPT`, `11me/light-session`, `dizzpy/ChatGPT-Auto-Continue`, or `boringresearch/plugin-chatgpt-automation` is copied into v1.0.0. They were behavior/design references only. ChatSentinel has zero npm dependencies.

See:

- `docs/PRODUCTION_READINESS.md`
- `docs/THREAT_MODEL.md`
- `docs/SOURCE_INVENTORY.md`
- `docs/PLUGIN_INTEGRATIONS.md`
- `docs/CANONICAL_HANDOFF.md`
