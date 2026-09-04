# Production Readiness — ChatSentinel v1.0.0

Status: **PRODUCTION CANDIDATE** until the exact release commit passes the final gates and is merged/tagged.

## Runtime boundary

ChatSentinel is a single-user, local-first Windows service bound to `127.0.0.1:4317` plus a Chrome Manifest V3 extension. The watchdog does not expose a LAN/public listener.

Production data lives outside the Git repository under `%LOCALAPPDATA%\ChatSentinel` by default:

- `data\state.json` — durable conversation/project policy and recent supervisor state.
- `logs\watchdog.jsonl` — structured watchdog audit log with rotation.
- `logs\supervisor.log` — Windows process-supervisor log.
- `keys\extension-private.pem` — local-only extension identity private key; never committed.

The production extension has stable ID `pcidbmcahljjpbmaecjmfmpbpfnpoepc`; only its public key is committed in `manifest.json`.

## Security gates

- Loopback-only HTTP clients.
- Browser requests accepted only from the paired Chrome extension origin and explicit extension-client header.
- First extension origin uses TOFU pairing; another extension origin is rejected.
- Pairing reset is local-process-only.
- No wildcard CORS.
- JSON-only write endpoints, bounded request bodies, bounded headers/connections and rate limiting.
- Automated recovery remains opt-in.
- Unknown side-effect state never becomes blind Retry.
- Production content script injects only on `https://chatgpt.com/*`.
- Zero npm runtime/dev dependencies; `npm audit` is a release gate.

## Durability and recovery

Project/policy configuration is persisted immediately. Session telemetry is debounced to reduce disk churn; its declared crash RPO is **<=300 ms**. State writes use a temporary file and replacement. Corrupt state is quarantined and startup proceeds with a clean state instead of crashing.

Sessions expire after 24 hours by default and are capped at 500 records. Both values are environment-configurable within safe bounds.

Windows supervision uses a named mutex to prevent duplicate supervisors. It prefers a per-user Scheduled Task and falls back to the user's Startup folder when Task Scheduler permissions are unavailable. A crashed watchdog is restarted automatically.

## Observability

`GET /health` reports version, PID, uptime, session/config counts, memory RSS, pairing state and heartbeat enablement. `GET /ready` is the readiness endpoint. `/supervisor` exposes normalized recovery state only.

Structured logs record lifecycle, rejected requests, configuration changes and recovery decisions. Prompt/body/token fields are redacted from logger inputs. ChatGPT message text is not sent to the watchdog.

## External monitoring

Watchgoose is optional and outside the critical recovery path. The local self-restart supervisor works without it. The installed Watchgoose check exists, but its private Ping URL/ping key is intentionally not derivable from the public slug; external heartbeat must only be enabled with the check's real private Ping URL via `CHATSENTINEL_HEARTBEAT_URL`.

## Release gates

A production release must pass:

1. `npm test`
2. `npm run check`
3. `npm run policy-check`
4. `npm run e2e`
5. `npm run prod-smoke`
6. `npm audit --omit=dev`
7. PowerShell parser validation for install/supervisor/uninstall scripts.
8. Exact local HEAD = remote release commit and clean working tree.
9. Deliberate watchdog kill followed by automatic restart and restored health.
