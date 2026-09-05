# Production Readiness — ChatSentinel v1.1.0

Status: **PRODUCTION CANDIDATE** until the exact final commit passes every release/installation/live-browser gate.

## Runtime boundary

ChatSentinel is a single-user, local-first Windows watchdog bound to `127.0.0.1:4317` plus a Chrome Manifest V3 extension. It exposes no LAN/public listener. v1.1 adds a multi-project registry and a Shadow DOM console rendered inside the active `chatgpt.com` page.

Production data lives under `%LOCALAPPDATA%\ChatSentinel`:

- `data\state.json` — projects, chat membership, policies and recent supervisor state.
- `logs\watchdog.jsonl` — structured audit/recovery log with rotation.
- `logs\supervisor.log` — Windows process-supervisor log.
- `keys\extension-private.pem` — local-only extension identity private key.

Stable extension ID: `pcidbmcahljjpbmaecjmfmpbpfnpoepc`.

## v1.1 project model

`Project → Parallel Chats → Live Session State`

A Project owns its local Git path, default operation policy, per-project auto-recovery flag, Chrome Tab Group preference/color and any number of ChatGPT conversations. Each conversation stores the current Chrome tab/title/URL when available. Project membership persists across watchdog restarts; stale tab IDs can reopen from the saved ChatGPT URL.

Legacy v1 conversation→projectPath configurations are migrated into deterministic v1.1 Project records on first load.

## Browser/UI guarantees

- The toolbar action has **no popup** and no Chrome Side Panel.
- Clicking ChatSentinel toggles the project console inside the current ChatGPT page.
- If a pre-existing ChatGPT tab has no injected listener after an extension reload, `chrome.scripting` injects the console on demand.
- Conversation identity is resolved from URL/sidebar/canonical/history/resource evidence; if unavailable, a unique `tab:<id>` identity prevents cross-chat collisions.
- When a stable conversation ID later becomes known, project membership migrates from the temporary tab identity.
- Project chats are grouped with Chrome's native `tabs.group`/`tabGroups.update` APIs, separated by browser window.

## Security gates

- Loopback-only watchdog HTTP clients.
- Browser requests accepted only from the paired extension origin + explicit client header.
- TOFU extension pairing; local-process-only pairing reset.
- No wildcard production CORS or test host patterns.
- JSON-only bounded write endpoints, bounded headers/connections and rate limiting.
- Global auto-recovery master **and** per-project auto-recovery must both be enabled.
- Unknown side-effect state never becomes blind Retry.
- Production content scripts inject only on `https://chatgpt.com/*`.
- Legacy popup files are forbidden by policy check.
- Zero npm runtime/dev dependencies; `npm audit` is a release gate.

## Durability

Project/config changes persist immediately. Session telemetry is debounced with declared crash RPO **<=300 ms**. Atomic replacement is used for state writes; corrupt state is quarantined. Sessions expire after 24 hours by default and are capped at 500 records. Windows supervision uses a named mutex plus Scheduled Task or Startup fallback and restarts a crashed watchdog automatically.

## Observability and external monitoring

`/health` reports version, PID, uptime, project/session/config counts, memory, pairing and heartbeat. `/projects` exposes normalized project/chat state; `/supervisor` exposes recovery state. Structured logs record lifecycle, rejected requests, project/config changes and recovery decisions without sending ChatGPT message bodies to the watchdog.

Watchgoose remains optional and outside the critical recovery path. Its check can be armed only with the real private Ping URL via `CHATSENTINEL_HEARTBEAT_URL`.

## v1.1 release gates

1. All unit/integration tests, including project isolation and v1 migration.
2. JS + PowerShell parser checks.
3. Production security/policy check (no popup/test permissions in shipping manifest).
4. Isolated Chromium detector/identity E2E.
5. SAFE_RETRY, Continue Same Chat, New Chat + handoff E2E.
6. In-page project console create/settings/attach E2E.
7. Native Chrome Tab Group + chat focus E2E.
8. Multi-project process restart/persistence production smoke.
9. `npm audit --omit=dev` = 0 vulnerabilities.
10. Exact pushed branch SHA validation, fast-forward main, exact-main revalidation.
11. Installed Windows watchdog upgrade + deliberate kill/self-restart.
12. One-time unpacked extension Reload in the user's normal Chrome profile followed by live in-page console/project-group verification.

Third-party attribution is tracked in `THIRD_PARTY_NOTICES.md`, `LICENSES/` and `docs/SOURCE_INVENTORY.md`.

## v1.3.0 superseding production-readiness status — 2026-09-05

The v1.1 material above is historical. ChatSentinel v1.3.0 has now completed the cross-platform implementation acceptance boundary on exact implementation `a65c436462d0a4fe3ac6524ae5374112b84a83bc` (tree `fb1288bf52f7bcdcb4de9da0049226dc0e65a809`). Windows release gates are fully green at 179/179 tests plus version/syntax/policy/shell/browser-E2E/production-smoke/audit/diff, PowerShell parser 7/7 and repository-boundary scan 0. Existing Windows live production acceptance confirms Watchdog 1.3.0, supervisor self-restart, unpacked extension 1.3.0, and the in-page Full Project Mode surface.

GitHub-hosted macOS 15 ARM64 run `33980902560` is fully green on the same exact main SHA through release validation, setup inspection, launchd installation, live health 1.3.0, KeepAlive restart to a new PID, and cleanup. Rollback 1.2.1 remains checksum-verified and separately installable.

Production tagging remains fail-closed until the documentation-bound exact SHA repeats all independent gates, exact main repeats macOS Live Acceptance, and the exact v1.3.0 archive is checksum-verified. When those gates pass, the Full Project Mode prohibition on Production tagging is satisfied for v1.3.0.
