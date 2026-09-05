# ChatSentinel 1.3 Cross-Platform Setup

Baseline 1.2.0 is frozen separately at Git branch `baseline/v1.2.0` and in the external version archive directory. Development of this setup layer occurs only on `feat/v1.3-cross-platform-bootstrap`.

## Goal

One small bootstrap prepares a Windows or macOS machine, then the shared Node.js Setup Controller handles inspection, installation planning, watchdog service setup, and optional GitHub self-hosted runner preparation. Projects on different computers remain independent; no cross-device lane locking is required for that operating model.

## First-stage bootstrap

Windows plan-only:
`powershell -ExecutionPolicy Bypass -File scripts\bootstrap-windows.ps1`

Windows apply:
`powershell -ExecutionPolicy Bypass -File scripts\bootstrap-windows.ps1 -Apply -Service`

macOS plan-only:
`bash scripts/bootstrap-macos.sh`

macOS apply (Homebrew already present):
`bash scripts/bootstrap-macos.sh --apply --service`

macOS apply and allow Homebrew installation if absent:
`bash scripts/bootstrap-macos.sh --apply --install-homebrew --service`
## Shared Setup Controller

`npm run setup:inspect` reports OS/architecture, Node, Git, Chrome, GitHub CLI, package manager, runner status, Watchdog health and extension pairing.

`npm run setup:plan -- --service` produces an approval-required plan. It does not install anything.

`node scripts/setup-cli.mjs apply --service --approve <step-id,...>` remains dry-run. Add `--execute` only after explicitly approving the exact step IDs.

The in-page ChatSentinel panel exposes the same read-only environment setup status and bootstrap command. System installation is not delegated to browser content scripts.

## ChatGPT / MCP Setup Bridge

Run `npm run setup:mcp` to expose the local stdio MCP server. It provides:
- `setup_status` — read-only device inspection;
- `setup_plan` — read-only install/service plan;
- `setup_apply` — only approved step IDs, dry-run unless `execute=true`;
- `runner_plan` — read-only runner plan.

The bridge is designed for an authorized local/remote connector. It intentionally does not bypass OS permissions or silently install software.

## Optional GitHub runner

Plan only:
`node scripts/setup-runner.mjs --repo OWNER/REPO --labels chatsentinel-mac,project-a`

Apply only after GitHub CLI authentication:
`node scripts/setup-runner.mjs --repo OWNER/REPO --labels chatsentinel-mac,project-a --apply --service`

Add `--replace` only when intentionally replacing an already-configured runner.

On macOS, the runner package is selected for `osx-arm64` or `osx-x64` from the native device profile. On Windows it selects `win-x64`/`win-arm64` where supported. Runner registration uses a time-limited GitHub registration token resolved at apply time, never stored in the plan.

## Repair, uninstall and version archives

Repair plan:
`node scripts/setup-cli.mjs repair-plan`

Safe uninstall plan (ChatSentinel-owned Watchdog service only):
`node scripts/setup-cli.mjs uninstall-plan`

Maintenance apply remains dry-run unless both exact step approvals and `--execute` are provided.

Create an immutable version archive:
`node scripts/archive-version.mjs --version 1.3.0 --ref <exact-branch-or-tag> --destination <archive-folder>`

Install an archived version side-by-side (plan only):
`node scripts/install-archived-version.mjs --archive <archive-folder> --destination <new-install-folder>`

Add `--execute` to extract after checksum verification. Existing non-empty destinations are never overwritten unless `--replace` is explicitly supplied. This makes rollback a side-by-side version selection rather than a destructive overwrite.
