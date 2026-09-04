# Validation — ChatSentinel v1.1.0

Status: **PRE-RELEASE GATES PASS**; exact pushed-SHA and live normal-Chrome activation remain release gates.

## Functional/unit/integration

Executed on Windows / Node.js 22.16.0:

- **32/32 tests PASS**.
- Multi-project isolation: PASS (different project policies, parallel chats, restart persistence).
- v1 single-project state → v1.1 Project registry migration: PASS.
- Project/settings validation and project attachment validation: PASS.
- Existing recovery/security/persistence/corrupt-state tests: PASS.

## Browser E2E — isolated Chromium

Shipping manifest is copied to a temporary test extension and only that temporary copy receives `<all_urls>` fixture permissions. Production manifest stays `https://chatgpt.com/*` only.

- RUNNING → `WAIT`: PASS
- Retry unknown → `ESCALATE`: PASS
- interrupted stream → `RELOAD_AND_RECHECK`: PASS
- dead conversation → `CONTINUE_NEW_CHAT`: PASS
- frozen UI → `RELOAD_AND_RECHECK`: PASS
- root-route conversation identity from state evidence: PASS
- exact root-route no-ID → unique `tab:<id>` fallback: PASS
- SAFE_RETRY + incident counter reset: PASS
- CONTINUE_SAME_CHAT: PASS
- CONTINUE_NEW_CHAT + handoff: PASS

## v1.1 in-page/multi-chat acceptance

- toolbar-control surface uses no popup/Side Panel: policy PASS.
- in-page Shadow DOM Project Console becomes visible in the same ChatGPT page: PASS.
- project create/settings through in-page UI: PASS.
- attach current chat through in-page UI: PASS.
- two parallel chats belong to one project: PASS.
- native Chrome Tab Group created with project title/color and both tabs: PASS.
- project chat focus/open behavior: PASS.
- stable extension ID remains `pcidbmcahljjpbmaecjmfmpbpfnpoepc`: PASS.

## Production gates

- `npm run check`: PASS.
- `npm run policy-check`: PASS.
- `npm run prod-smoke`: PASS, including Project+chat persistence over process kill/restart.
- `npm audit --omit=dev`: **0 vulnerabilities**.
- npm dependencies: **0**; devDependencies: **0**.
- `git diff --check`: PASS.
- PowerShell parser: PASS for supervisor/install/uninstall/setup/pairing/setup-extension scripts.
- third-party MIT/Apache notices/licenses present: PASS.

## Remaining exact release sequence

1. Commit/push v1.1 candidate and record SHA/tree.
2. Re-run `npm run release-validate` on exact local=remote candidate SHA with clean tree.
3. Fast-forward `main`, then re-run exact-main release gate.
4. Run upgrade-aware installer against the currently installed v1.0 watchdog.
5. Deliberately kill installed v1.1 listener and verify supervisor self-restart.
6. Reload the unpacked Chrome extension once in the user's Default profile.
7. Live verify: toolbar click opens in-page console, create/attach a real project, project appears with current chat, and parallel project tabs group correctly.
8. Only then tag/release `v1.1.0` and mark Production-ready.
