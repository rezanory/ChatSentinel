# ChatSentinel

ChatSentinel is a local-first watchdog and recovery controller for long-running ChatGPT project work. It observes ChatGPT conversations, reconciles external project state and selects the safest recovery action instead of blindly pressing Retry.

## Recovery actions

- `WAIT` — execution still appears active.
- `SAFE_RETRY` — retry only when the operation is explicitly classified read-only/idempotent.
- `CONTINUE_SAME_CHAT` — send a checkpoint-aware continuation prompt.
- `RELOAD_AND_RECHECK` — recover a frozen/interrupted UI without repeating project work.
- `CONTINUE_NEW_CHAT` — move to a new conversation and carry a generated handoff prompt.
- `ESCALATE` — state is too uncertain for an automatic write-like action.

## Safety invariants

1. A visible Retry button is never sufficient evidence for Retry.
2. A project checkpoint is fresh only when the Git working tree is clean and local HEAD equals remote HEAD.
3. Active work is never interrupted merely because the UI has been quiet.
4. Automated UI actions are opt-in and can be disabled from the extension popup.
5. GitHub/source-of-truth wins over stale conversation state.

## Components

- `extension/` — Chrome MV3 Browser Sentinel, guarded actuator and supervisor popup.
- `src/recovery-engine.js` — deterministic recovery policy.
- `src/side-effect-classifier.js` — side-effect/idempotency classification.
- `src/project-reconciler.js` — local Git/remote reconciliation.
- `src/local-watchdog.js` — localhost controller and multi-session supervisor.
- `src/heartbeat.js` — optional dead-man heartbeat emitter.
- `scripts/run-watchdog.ps1` — self-restarting Windows supervisor.
- `scripts/e2e/` — real unpacked-extension fault-injection harness using isolated Chromium.
## Install / run on Windows

```powershell
cd C:\ChatSentinel
npm run validate
powershell -ExecutionPolicy Bypass -File .\scripts\install-autostart.ps1
```

Load `C:\ChatSentinel\extension` as an unpacked extension in Chrome (`chrome://extensions` → Developer mode → Load unpacked). The popup shows watchdog health, observed sessions, recovery decisions and the guarded auto-recovery switch.

For a project conversation, open the popup once and register its local project path. The mapping is stored in Chrome storage and is automatically re-sent after a watchdog restart. Use `Read-only` only for conversations where repeating the current operation is truly safe; otherwise leave the conservative policy or select `Write`.

## Validation

```powershell
npm test
npm run check
npm run e2e
```

The E2E harness launches an isolated Chromium profile, loads the real unpacked extension and injects controlled `running`, `Retry`, interruption, dead-conversation and frozen-UI states. It also validates the guarded `SAFE_RETRY`, `CONTINUE_SAME_CHAT` and `CONTINUE_NEW_CHAT + handoff` actuators.

## Watchgoose

Set `CHATSENTINEL_HEARTBEAT_URL` to the private Ping URL of the Watchgoose check before starting the watchdog. The heartbeat is optional; local supervision works without it.

## Source policy

The core is original code. GPL projects such as KeepChatGPT are behavioral references only unless a separate GPL-compatible distribution decision is made. See `docs/SOURCE_INVENTORY.md` and `docs/PLUGIN_INTEGRATIONS.md`.
