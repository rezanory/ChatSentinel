# Validation — ChatSentinel v1.0.0 Production Candidate

## Release gate results

Executed on Windows with Node.js 22.16.0 against the production hardening branch.

- Unit/integration tests: **28/28 PASS**
- JavaScript syntax checks: **PASS**
- PowerShell parser checks: **PASS**
- Production policy/security check: **PASS**
- npm runtime dependencies: **0**
- npm development dependencies: **0**
- `npm audit --omit=dev`: **0 vulnerabilities**
- Browser detector/recovery E2E: **5/5 PASS**
- `SAFE_RETRY` actuator: **PASS**
- Retry incident counter reset: **PASS**
- `CONTINUE_SAME_CHAT` actuator: **PASS**
- `CONTINUE_NEW_CHAT + handoff` actuator: **PASS**
- Production process kill/restart + state restore smoke: **PASS**

## Browser E2E scenarios

The harness creates a temporary copy of the production extension, grants fixture access only to that copy, launches an isolated Chromium profile with a dynamically allocated DevTools port, and uses a dedicated watchdog instance/data directory.

Validated states:

1. active generation -> `WAIT`
2. Retry with unknown side-effect state -> `ESCALATE`
3. interrupted stream with uncertain checkpoint -> `RELOAD_AND_RECHECK`
4. dead conversation -> `CONTINUE_NEW_CHAT`
5. frozen UI -> `RELOAD_AND_RECHECK`

## Security/durability evidence

- Loopback-only client enforcement tested.
- Ordinary web origins rejected.
- Stable extension origin TOFU pairing tested; mismatched extension rejected.
- Local-process-only pairing reset tested.
- JSON content-type/body validation tested.
- Rate limiting tested.
- Persistent config/session restore across server restart tested.
- Corrupt state quarantine tested.
- Session TTL/max-record pruning tested.
- Production manifest injects only on `https://chatgpt.com/*`.
- Stable extension ID asserted by E2E/policy checks: `pcidbmcahljjpbmaecjmfmpbpfnpoepc`.
- Private extension key verified outside repository only.
- Structured log generation and recovery-decision audit record tested.

## Declared durability

Conversation/project policy writes are immediate. Recent session telemetry is debounced; crash RPO is **<=300 ms**. Windows supervisor restarts a crashed watchdog; production smoke verifies disk state restores after restart.

## Final acceptance procedure

After this candidate is committed/pushed, `npm run release-validate` is executed again against the exact candidate SHA. Then main is fast-forwarded, the installed watchdog is upgraded/restarted, deliberate kill/self-restart is revalidated, and only that exact accepted commit is tagged `v1.0.0`.

## Exact pushed candidate validation

Accepted production code candidate:

- SHA: `cac04a8b99d35d466dbbb7979e79b6115bb25149`
- Tree: `b460be6fb5862db8ce2c5fd9a0c86375b981618c`
- local HEAD = remote `release/v1.0.0-production`: PASS
- clean working tree before validation: PASS
- full `npm run release-validate` on exact pushed SHA: PASS

The subsequent handoff metadata commit is documentation-only; it receives one final release validation before merge/tag.
