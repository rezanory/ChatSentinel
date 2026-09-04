# Chat Control v1 Handoff

Status: GREEN lane candidate
Branch: `feat/chat-control-v1`
Baseline: `080909f8fd691b8e043b6b3083e131a159749a98`
Implementation commit: `46317fabcfe3047fddb603080ea527295496bab5`

## Scope delivered

Standalone Component-First Chat Control for:
- `FOCUS_CHAT`
- `RELOAD_CHAT`
- `CLOSE_CHAT`
- `REPLACE_CHAT`

The component owns policy, bounded retries, stale-tab handling, replacement ordering/handoff, and replay idempotency markers. It does not own or duplicate the durable command queue or browser command executor.

## Owned paths

- `extension/components/chat-control/controller.js`
- `test/chat-control.test.js`

Composition-only integration change:
- `extension/command-executor.js`

## Behavior / safety notes

- Focus: reuses a live target; for a stale target it can recover through the existing safe ChatGPT URL focus/open adapter.
- Reload: retries transient browser failures; stale reload can route to replacement through the existing lane-chat creation path.
- Close: a missing tab is treated as an already-closed idempotent state.
- Replace: creates/restores the replacement first, then closes the old tab when policy requires it, preserving replacement result metadata.
- Durable command progress markers prevent completed command replays from repeating browser actions when checkpoint data is present.

## Validation evidence

Collect-all first pass found 3 focused-test fixture failures; all three were fixed-forward in lane scope. No product regression was found.

Final validation:
- `node --test test/chat-control.test.js`: 6/6 PASS
- explicit `node --check extension/components/chat-control/controller.js`: PASS
- `npm test`: 47/47 PASS
- `npm run check`: PASS
- `npm run policy-check`: PASS
- `npm run e2e`: PASS
- `npm run prod-smoke`: PASS
- `npm run security-audit`: PASS, 0 vulnerabilities
- `git diff --check`: PASS

No merge to `main` was performed. Integration/release gates remain owned by the integration lane and Issue #3 acceptance.
