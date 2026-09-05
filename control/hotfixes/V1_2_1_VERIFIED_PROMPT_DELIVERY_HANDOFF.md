# ChatSentinel v1.2.1 Verified Prompt Delivery Handoff

Date: 2026-09-05
Branch: `hotfix/v1.2.1-verified-prompt-delivery`
Immutable baseline: `9ec1cd6ab074556620015c655505ec62f6a3101a` (`baseline/v1.2.0`)
Implementation SHA: `0a5b2dec09b1beb281ec4a857b2c4e3edee22b55`
Implementation tree: `a511bc98682395bb79cc6ff8bd95046afdc97259`

## Incident

Live review showed a newly-created ChatGPT lane tab with an empty composer while the full lane prompt appeared in the browser URL as `?prompt-textarea=...`. The durable command had already reported `promptSent=true`, so command success was not evidence of actual ChatGPT message acceptance.

The launch URL itself was clean (`https://chatgpt.com/`). The failure happened after DOM prompt injection: a generic form submit could navigate with the textarea field encoded into the query string while ChatSentinel immediately treated the button click as success.

## Fix

- Added standalone `extension/components/prompt-delivery/controller.js`.
- Prompt injection waits for ChatGPT to expose an explicit ready send control; generic GET-form submit buttons are not accepted.
- Durable commands verify real delivery evidence before setting `promptSent=true` / `deliveryConfirmed=true`.
- Evidence is a matching rendered user turn, or a new stable `/c/...` conversation URL for a newly-created chat.
- `?prompt=`, `?prompt-textarea=`, `?message=` or `?text=` contamination is a hard delivery failure and is sanitized before bounded retry.
- Content-script command deduplication is marked only after background verification, not after a button click.
- Existing live prompt ownership created by an older false-success build is revalidated; an unconfirmed owner is reused and recovered rather than trusted blindly.
- Release surfaces are normalized to `1.2.1`, including the previously stale lockfile version.

## Validation before documentation binding

- Unit: `129/129 PASS`.
- Syntax/check: PASS.
- Security policy: PASS; zero runtime dependencies; stable extension ID preserved.
- Browser E2E: PASS, including a deliberate GET-form trap that would reproduce `?prompt-textarea=` if the wrong send control were clicked.
- Browser assertion: `verified prompt delivery rejects GET-form URL contamination: PASS`.
- Production smoke: PASS.
- `npm audit --omit=dev`: 0 vulnerabilities.
- PowerShell parser: all production `.ps1` scripts PASS.
- `git diff --check`: PASS.

The exact docs-bound SHA must pass the same full gate set before promotion to the stable runtime.
