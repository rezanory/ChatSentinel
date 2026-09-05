# ChatSentinel v1.3 Anti-Blocker V1

Date: 2026-09-05
Branch: `feat/v1.3-cross-platform-bootstrap`
Baseline: `baseline/v1.2.0` @ `9ec1cd6ab074556620015c655505ec62f6a3101a`

## Resolved during implementation

- The existing Windows-centric runtime data path was moved behind a platform-aware device profile.
- `package-lock.json` was discovered stale at 1.1.1 and is now governed by a release version-consistency gate.
- Browser E2E originally preferred a Windows-only/host-specific discovery path; locator now models target-platform separators and macOS/Linux locations.
- Playwright Chromium is preferred for isolated E2E, with installed Chrome as fallback.
- macOS shell files are committed executable and `.gitattributes` forces LF line endings.
- Windows/macOS bootstrap defaults to plan-only; package installation requires explicit apply.
- Missing Homebrew/winget is represented without pretending an automatic install is possible.
- Setup apply is blocked from extension-origin requests and requires the local-process trust boundary.
- Setup MCP apply/maintenance tools are approval-gated and dry-run unless `execute=true`.
- Runner registration tokens are requested only during apply and are never embedded in plans or source.
- Shared prerequisites are retained during ChatSentinel uninstall; only owned service configuration is removed.
- Full Project Mode button never auto-sends and repeated clicks do not duplicate the activation phrase.

## Remaining environmental acceptance

A physical macOS device is not currently connected to the authorized command channel. macOS live checks must cover bootstrap, Chrome extension load, Watchdog launchd persistence, restart recovery, Setup Assistant health, and optional runner registration before macOS deployment is called production-validated.

## Remote bridge visibility

Windows Runner process discovery uses `tasklist`; Remote Desktop Commander discovery needs command-line evidence because its executable is normally Node.js. The Windows remote-bridge probe therefore uses a cached `Get-CimInstance Win32_Process` query only when no explicit bridge registration environment variable exists. This keeps Setup refresh responsive while avoiding a false “bridge missing” result on the current device.

## Windows test teardown stabilization

A final aggregate run exposed a Windows-only `EBUSY` during temporary server-directory removal after the multi-project integration test had already passed. Test cleanup now uses a bounded retry helper only for `EBUSY`, `EPERM`, and `ENOTEMPTY`; unrelated cleanup errors still fail immediately and the final retry still fails closed. The complete server integration file passed three consecutive runs after this harness-only stabilization. Product runtime behavior is unchanged.
