# Canonical Handoff — ChatSentinel v1.0.0

Status: **PRODUCTION ACCEPTED CODE CANDIDATE**

Repository: `rezanory/ChatSentinel`
Local path: `C:\ChatSentinel`
Candidate branch: `release/v1.0.0-production`
Target branch: `main`
Previous release: `v0.3.0` at `c6df780b0aa120d618574d8ee061b099e5ecaec1`

## Exact accepted production code candidate

- SHA: `cac04a8b99d35d466dbbb7979e79b6115bb25149`
- Tree: `b460be6fb5862db8ce2c5fd9a0c86375b981618c`
- Local candidate HEAD = remote candidate HEAD: PASS
- Working tree clean at candidate validation: PASS
- `npm run release-validate` on this exact SHA: PASS

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

Accepted candidate evidence:

- 28/28 unit/integration tests PASS
- JavaScript and PowerShell parser checks PASS
- production security/policy check PASS
- isolated extension detector/recovery E2E 5/5 PASS
- `SAFE_RETRY`, retry-counter reset, `CONTINUE_SAME_CHAT`, `CONTINUE_NEW_CHAT + handoff` PASS
- production process restart/persistence smoke PASS
- npm dependencies 0 / devDependencies 0
- `npm audit --omit=dev`: 0 vulnerabilities

Exact details are in `docs/VALIDATION.md`.

## Third-party provenance

No source code from `xcanwin/KeepChatGPT`, `11me/light-session`, `dizzpy/ChatGPT-Auto-Continue`, or `boringresearch/plugin-chatgpt-automation` is present in production code. They are behavior/design references only.

No plugin/MCP source code is vendored. GitHub and Remote Desktop Commander were actively used as external development/operations tools. Watchgoose check infrastructure exists but external heartbeat remains optional/unarmed until its real private Ping URL is supplied. Other plugin candidates are optional, non-critical integrations.

## Operational paths

- service: `127.0.0.1:4317`
- extension: `C:\ChatSentinel\extension`
- data: `%LOCALAPPDATA%\ChatSentinel\data\state.json`
- structured logs: `%LOCALAPPDATA%\ChatSentinel\logs\watchdog.jsonl`
- supervisor log: `%LOCALAPPDATA%\ChatSentinel\logs\supervisor.log`
- extension private key (local only): `%LOCALAPPDATA%\ChatSentinel\keys\extension-private.pem`
- stable extension ID: `pcidbmcahljjpbmaecjmfmpbpfnpoepc`

## Final release procedure

This handoff update is documentation-only relative to the accepted code candidate. After committing/pushing it, the release gate must run once more on that exact final branch commit. If it passes, `main` is fast-forwarded, the installed watchdog is upgraded and restarted, deliberate kill/self-restart is revalidated, and only then is that exact `main` commit tagged/released as `v1.0.0`.
