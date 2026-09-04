# Canonical Handoff — ChatSentinel v0.3.0

Status: **MVP_ACCEPTED / OPERATIONAL_BASELINE**

Repository: `rezanory/ChatSentinel`
Local canonical checkout: `C:\ChatSentinel`
Branch: `main`

## Purpose

ChatSentinel is an external conversation watchdog for long-running ChatGPT project work. It detects interruption/stall/dead-chat conditions, reconciles project evidence and chooses or executes the safest recovery action so a ChatGPT UI failure does not stop the project.

## Implemented capability

- ChatGPT DOM detector for running, Retry, interruption, dead conversation and frozen UI states.
- deterministic recovery engine: `WAIT`, `SAFE_RETRY`, `CONTINUE_SAME_CHAT`, `RELOAD_AND_RECHECK`, `CONTINUE_NEW_CHAT`, `ESCALATE`.
- Git local/remote reconciler.
- project-aware side-effect/idempotency classifier.
- strict fresh-checkpoint invariant: clean tree and local HEAD equals remote HEAD.
- guarded browser actuator for Retry, Continue, reload and New Chat + handoff.
- durable conversation→project/policy mapping in Chrome storage.
- multi-chat supervisor endpoint and extension popup.
- localhost watchdog service with optional external heartbeat.
- Windows self-restarting supervisor and user-level Startup autostart fallback.
- isolated Chromium fault-injection harness using the real unpacked extension.
## Acceptance evidence

- Unit tests: 13/13 PASS.
- JavaScript and PowerShell syntax validation: PASS.
- Detector/recovery browser E2E: 5/5 PASS.
- `SAFE_RETRY` actuator: PASS.
- `CONTINUE_SAME_CHAT` actuator: PASS.
- `CONTINUE_NEW_CHAT` + handoff actuator: PASS.
- watchdog deliberate-kill/self-restart: PASS.
- autostart fallback installed in the current Windows user's Startup folder.

See `docs/VALIDATION.md` for the detailed receipt.

## Safety invariants

1. Never blind-Retry because the UI exposes Retry.
2. Never interrupt a conversation while generation/external activity is still evidenced.
3. Never claim a Git checkpoint is fresh unless the tree is clean and `HEAD == remoteHead`.
4. Unknown side effects fail conservative (`ESCALATE` / recheck), not optimistic.
5. Browser write-like recovery is guarded and auto-recovery is opt-in.
6. GitHub/source-of-truth supersedes stale chat state.

## External integrations

GitHub is canonical evidence. Remote Desktop Commander can inspect/recover the host. Watchgoose check `chatsentinel` exists as the external dead-man monitor; its private Ping URL must be injected via `CHATSENTINEL_HEARTBEAT_URL` to arm it. Make/aictrl.dev/Brainbase/WebMCP are optional extensions, not critical-path dependencies.

## Operational activation

The local watchdog is operational and supervised. One browser-security step remains for the user's normal Chrome profile: load `C:\ChatSentinel\extension` once as an unpacked extension. After that, use the popup to bind a ChatGPT conversation to its local project path and optionally enable guarded auto recovery.

This file is the latest non-superseded handoff. Older ChatSentinel handoffs are superseded by this v0.3.0 baseline.
