# ChatSentinel v1.3.1 Adaptive Request-Throttle Acceptance Handoff

## Accepted implementation

- Baseline: `b8c7b18c8cf0cdaf08e29c54b835da5ecfc0a426` (v1.3.0 final release).
- Accepted implementation: `cc7d3eefe10cabe0be46dda324b02a6294037f5c`.
- Tree: `9fbe4acef491de4b967a3385c65f960be9d4c723`.
- Branch: `fix/v1.3.1-adaptive-rate-limit`.

## New failure mode

`Too many requests` is now handled as its own bounded recovery mode. ChatSentinel detects the active ChatGPT rate-limit modal, auto-clicks its visible acknowledgement control (`Got it` and bounded equivalents), records the incident, and backs off request-making work instead of immediately resuming the prior burst rate. It is not conflated with connection interruption, message-delivery timeout, or renderer/tab crash recovery.

Adaptive levels use 2/4/8/15 minute cooldowns with 10/20/30/45 second minimum request gaps after recovery. Command batches shrink from the normal maximum of 6 to 2 at level 1 and 1 at levels 2-4. Duplicate observation of the same visible incident is bounded. After a healthy window, the level decays toward normal.

## Anti-Blocker behavior

During cooldown, `CREATE_LANE_CHAT`, `SEND_PROMPT`, `RELOAD_CHAT`, and `REPLACE_CHAT` are excluded from queue claims without consuming their attempt budgets. Independent local control work such as grouping, focus, and close remains claimable. A second gate immediately before prompt-side effects catches a rate limit that appears after a command was already claimed.

## Acceptance evidence

Windows exact-candidate validation is green: 184/184 tests, version consistency, syntax/check, security policy, shell parsing, browser E2E, production smoke, npm audit with 0 vulnerabilities, PowerShell parser 7/7, repository-boundary scan 0, and diff check. Browser E2E explicitly proves `Too many requests` -> automatic `Got it` click -> persisted adaptive cooldown -> reset isolation -> subsequent command-manager success.

GitHub-hosted macOS 15 ARM64 run `33992650575` is SUCCESS on the exact accepted implementation SHA. Release validation, setup inspection, launchd install, live health 1.3.1, deliberate SIGKILL/KeepAlive restart (`19466` -> `19790`), and cleanup all passed.

## Release boundary

This handoff accepts the implementation but does not self-authorize a stale binary/runtime. The docs-bound final SHA must repeat exact Windows release validation and macOS Live Acceptance, then be archived and checksum-verified, promoted ancestry-safely, tagged/released, deployed to `C:\ChatSentinel`, Watchdog-restarted, and the unpacked extension at `C:\ChatSentinel\extension` actually reloaded and verified as 1.3.1.
