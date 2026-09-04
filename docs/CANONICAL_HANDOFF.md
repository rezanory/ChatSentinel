# Canonical Handoff — ChatSentinel v1.0.0

Status: **PRODUCTION CANDIDATE**

Repository: `rezanory/ChatSentinel`
Local path: `C:\ChatSentinel`
Production candidate branch: `release/v1.0.0-production`
Target branch: `main`
Previous release: `v0.3.0` at `c6df780b0aa120d618574d8ee061b099e5ecaec1`

## Product mission

ChatSentinel prevents long-running ChatGPT project work from sleeping when a conversation encounters connection interruption, Retry-only recovery, UI freeze, unknown execution state or an unrecoverable/dead conversation.

## Production invariants

- Never blind-Retry from UI evidence alone.
- Active execution wins over timeout heuristics.
- Git/source-of-truth is reconciled before repeating write-capable project work.
- Fresh checkpoint requires clean tree + local HEAD == remote HEAD.
- Auto-recovery is opt-in and fails closed on missing controls/evidence.
- Watchdog lives outside the affected ChatGPT conversation.
- Production HTTP surface is loopback-only and extension-origin guarded.
- Durable runtime state/logs/private extension key live outside the Git repository.

## Production capabilities

Browser signal detector, deterministic recovery engine, project-aware side-effect classifier, Git reconciler, guarded Retry/Continue/New-Chat actuators, durable state store, JSONL audit logging, secured localhost API, supervisor popup, Windows self-restart/autostart, stable extension identity and isolated production E2E harness.

## Validation evidence

The production candidate currently passes 28/28 unit/integration tests, syntax checks, PowerShell parser checks, production security policy, isolated extension E2E, production restart/persistence smoke and npm audit with zero vulnerabilities. Exact evidence is maintained in `docs/VALIDATION.md`.

## Third-party provenance

No source code from the reviewed GitHub projects (`xcanwin/KeepChatGPT`, `11me/light-session`, `dizzpy/ChatGPT-Auto-Continue`, `boringresearch/plugin-chatgpt-automation`) is present in production code. They are behavior/design references only. See `docs/SOURCE_INVENTORY.md`.

No plugin/MCP source code is vendored. GitHub and Remote Desktop Commander were actively used as external development/operations tools; Watchgoose check infrastructure was created but external pinging is optional and unarmed until a real private Ping URL is supplied. Other plugin candidates are non-critical optional integrations. See `docs/PLUGIN_INTEGRATIONS.md`.

## Operational paths

- service: `127.0.0.1:4317`
- extension: `C:\ChatSentinel\extension`
- data: `%LOCALAPPDATA%\ChatSentinel\data\state.json`
- structured logs: `%LOCALAPPDATA%\ChatSentinel\logs\watchdog.jsonl`
- supervisor log: `%LOCALAPPDATA%\ChatSentinel\logs\supervisor.log`
- extension private key (local only): `%LOCALAPPDATA%\ChatSentinel\keys\extension-private.pem`
- stable extension ID: `pcidbmcahljjpbmaecjmfmpbpfnpoepc`

## Release next action

Commit and push this production candidate, record its exact SHA/tree below in the final release handoff update, re-run all release gates on the exact pushed commit, fast-forward `main`, upgrade the installed service, verify deliberate kill/self-restart, then tag/release `v1.0.0`. No Production-ready claim is valid before those exact steps pass.
