# ChatSentinel v1.3 Cross-Platform Bootstrap Handoff V1

Status: **GREEN IMPLEMENTATION CANDIDATE — EXACT DOCS-BOUND VALIDATION REQUIRED**

Repository: `rezanory/ChatSentinel`
Branch: `feat/v1.3-cross-platform-bootstrap`
Baseline: `baseline/v1.2.0`
Baseline SHA: `9ec1cd6ab074556620015c655505ec62f6a3101a`
Implementation SHA before handoff binding: `dafccc38eb7612d17902a65208f6b51d0f88e3d3`
Implementation tree: `4a7ec2d26a89672befe4de05d350255aca76492c`
Version: `1.3.0`
Date: 2026-09-05

## Baseline preservation

ChatSentinel 1.2.0 is preserved independently as remote branch `baseline/v1.2.0` and in `C:\ChatSentinel-versions\ChatSentinel-1.2.0-baseline` with source ZIP, extension ZIP, Git bundle, manifest, SHA256 checksums and install instructions. v1.3 development does not mutate that baseline.

## Delivered components

- Cross-platform device profile and native data directories for Windows/macOS/Linux.
- Prerequisite detector for Node.js, Git, Chrome, GitHub CLI, package manager, runner and optional remote bridge.
- Approval-gated install/update controller; plan-only and dry-run are the defaults.
- Repair and safe uninstall plans; shared prerequisites are never removed automatically.
- Windows `winget` bootstrap and existing Task Scheduler Watchdog integration.
- macOS Homebrew bootstrap, `launchd` Watchdog service and shell runner.
- Cross-platform Chrome/Playwright browser discovery for E2E.
- GitHub self-hosted runner planning and apply script with platform/architecture labels.
- Local stdio Setup MCP bridge exposing status, setup plan/apply, maintenance plan/apply and runner plan.
- Dedicated Extension Setup Assistant page with platform/prerequisite status and bootstrap guidance.
- `CHATSENTINEL FULL PROJECT MODE` canonical profile and one-click prompt prepend in the project panel.
- One-click prepend preserves existing prompt text, never auto-sends and is idempotent.
- Version consistency gate covers package, lockfile, extension, runtime, installer, E2E, smoke and Setup MCP.
- Immutable version archive creation and checksum-verified side-by-side archived-version installation.

## Validation evidence before handoff binding

- Version consistency: PASS for 1.3.0.
- Aggregate Node unit/integration suite: 145/145 PASS after fix-forward.
- Syntax/check: PASS.
- Security policy: PASS; zero runtime/dev dependencies and stable extension ID.
- macOS shell parser gate: 4/4 PASS.
- Windows PowerShell parser gate: all scripts PASS, including the new bootstrap.
- Browser E2E: PASS, including real Setup Assistant page and Full Project Mode one-click insertion.
- Production smoke: PASS.
- `npm audit --omit=dev`: zero vulnerabilities.
- `git diff --check`: PASS.

## Cross-platform acceptance boundary

Windows live behavior is exercised on the authorized current device. macOS-specific paths, Homebrew/launchd plans, ARM64 runner assets and shell syntax have deterministic unit/parser coverage, but no physical Mac is connected to this conversation. Therefore macOS **live-device acceptance remains pending** and must be executed on the Mac before calling the macOS deployment production-validated.

Runner registration is implemented but intentionally not executed without an explicit repository target, authenticated GitHub CLI and user-approved apply action on the target device. Registration tokens are resolved only at apply time and are not persisted in setup plans.

## Release boundary

The exact docs-bound SHA produced after this handoff must pass the complete independent gate set before push/freeze. `main` is not merged by this lane, Issue #3 is not closed here, and no Production tag is created. After the final green push, the Windows Watchdog may be restarted on 1.3.0 and the Chrome extension must be reloaded to activate the new UI; the frozen 1.2.0 baseline remains independently installable.

## Post-validation bridge detection fix-forward

Live Windows Setup sanity-check correctly detected the existing GitHub Runner but initially reported the active Remote Desktop Commander bridge as absent. The detector now performs a bounded Windows command-line process probe for `desktop-commander` / `wonderwhy-er`, cached for 30 seconds in the long-running Watchdog to avoid repeated WMI cost. Explicit `CHATSENTINEL_REMOTE_BRIDGE=1` registration remains the highest-priority signal. Focused detector tests and live `setup-cli inspect` now report the current bridge as `installed=true`, `source=process`. This change requires a new exact final validation before push/freeze.

## Final Windows harness stabilization

The exact pre-final candidate exposed one teardown-only Windows `EBUSY` while deleting a temporary integration-test directory. No product assertion failed and all other gates continued green. Cleanup now retries only the known transient Windows filesystem codes with a bounded backoff. `test/server.integration.test.js` then completed three consecutive 10/10 green runs. A new exact final SHA and complete independent revalidation are required before push.

## Final integrated v1.3 Windows acceptance — 2026-09-05

The earlier notes requiring a new exact final revalidation are superseded by the pushed integrated candidate lineage. Exact docs-bound validation basis `bd2271f033db44ded8b8f285639bc437720875c7` passed 175/175 unit tests plus version, syntax/check, security policy, shell parser, browser E2E, production smoke, zero-vulnerability audit, diff, cross-repository-boundary, and Windows PowerShell parser 7/7 gates.

Windows code/runtime acceptance is green. macOS code-level parser/unit coverage remains green, but macOS live-device deployment acceptance is still explicitly pending because no Mac device is connected; this must not be represented as a failed Windows or source-development gate.

## Final macOS hosted live acceptance — 2026-09-05

The pending macOS boundary above is now superseded. GitHub-hosted macOS 15 ARM64 run `33980902560` executed against exact main `a65c436462d0a4fe3ac6524ae5374112b84a83bc` (tree `fb1288bf52f7bcdcb4de9da0049226dc0e65a809`) and completed green. Release validation, native setup inspection and launchd installation all passed. `/health` returned ChatSentinel `1.3.0` with PID `15345`; after deliberate SIGKILL, launchd KeepAlive restored a healthy `1.3.0` Watchdog as PID `15632`; cleanup then removed `com.chatsentinel.watchdog` successfully.

The exact accepted implementation also passes the Windows collect-all release gates at 179/179 tests, PowerShell parser 7/7 and repository-boundary scan 0. Final release freeze now requires only the documentation-bound exact-SHA revalidation/archive/tag sequence recorded in `FINAL_CROSS_PLATFORM_ACCEPTANCE_HANDOFF.md`.
