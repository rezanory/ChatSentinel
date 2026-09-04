# Validation — ChatSentinel v0.3.0 MVP

## Final acceptance summary

Status: **MVP ACCEPTED**

Validated on Windows using Node.js 22.16.0 and an isolated unpacked-extension Chromium profile.

## Automated validation

- Unit tests: **13/13 PASS**
- JavaScript syntax checks: **PASS** across core, extension and E2E harness
- PowerShell syntax checks: **PASS** for supervisor/install/uninstall scripts
- Browser detector/recovery E2E: **5/5 PASS**
- Guarded actuator E2E: **3/3 PASS**

## Detector/recovery scenarios

- active generation -> `WAIT`
- Retry with unknown side effects -> `ESCALATE`
- interrupted stream without fresh checkpoint -> `RELOAD_AND_RECHECK`
- dead conversation -> `CONTINUE_NEW_CHAT`
- frozen UI -> `RELOAD_AND_RECHECK`

## Actuator scenarios

- explicitly read-only Retry -> `SAFE_RETRY` and button click: PASS
- interrupted project with clean synchronized checkpoint -> `CONTINUE_SAME_CHAT` and checkpoint-aware prompt: PASS
- dead conversation -> new chat navigation + `sessionStorage` handoff + automatic prompt delivery: PASS
## Git / side-effect safety

- Fresh checkpoint requires: valid Git repo + clean working tree + `HEAD == remoteHead`.
- Dirty or diverged trees are treated as possible side effects.
- Observed local/remote SHA movement is classified as confirmed side effect evidence.
- Explicit `read_only` policy allows safe Retry classification even when no project repository is attached.
- Unknown states remain conservative and never trigger blind Retry.

## Runtime smoke validation

A real local repository registration was validated against `C:\ChatSentinel` and its GitHub remote. A Retry scenario with possible side effects and a known clean checkpoint selected `CONTINUE_SAME_CHAT` rather than Retry.

## Supervisor / restart validation

Windows Scheduled Task creation was denied by host permissions, so the installer successfully used the per-user Startup-folder fallback:

`%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\ChatSentinelWatchdog.vbs`

The running watchdog listener was deliberately killed. The supervisor detected the failure and restored service with a new process ID; `/health` returned v0.3.0 after recovery. **Self-restart PASS.**

## Remaining operational note

The Chrome extension must be loaded once into the user's normal Chrome profile as an unpacked extension. This is a Chrome security/UI activation step, not an unimplemented ChatSentinel capability. Watchgoose heartbeat is optional until its private Ping URL is supplied through `CHATSENTINEL_HEARTBEAT_URL`.
