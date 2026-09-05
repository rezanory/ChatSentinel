# TLG Handoff — Tab Launch Guard

Status: **GREEN / EXACT IMPLEMENTATION CANDIDATE PUSHED**

Repository: `rezanory/ChatSentinel`
Worktree: `C:\ChatSentinel-worktrees\tab-launch-guard`
Branch: `feat/tab-launch-guard-v1`
Baseline / integration parent: `8f6bac468fdf0a90b2df63760d2101cba7bc7c37`

## Exact implementation candidate

- SHA: `99e0054cd27b9fad3eaaee950dad87b2040c47ae`
- Tree: `fbc3ff6d4a0abb69e8a44dc8b4830bd9fc0c9788`
- Local worktree clean on exact SHA: PASS
- Remote feature branch exact SHA: PASS

## Problems resolved

- New tab/request bursts are globally paced before ChatGPT navigation.
- New-chat launch URLs are sanitized and never carry prompt/draft text.
- `Too many requests` is detected before prompt delivery and backed off instead of request-storming.
- Browser renderer crash/unresponsive states are detected from internal URLs, titles and content patterns.
- Crash recovery is incident-based and bounded: reload same tab + continue, then replace + restore + continue, then halt.
- Changing crash/error pages during one incident do not reset the recovery budget.
- Crash continuation is reconcile-first and explicitly avoids replaying completed work or side effects.
- One logical `(project, lane/conversation, prompt)` owns one live tab; duplicate delivery to a second live tab is blocked.
- Explicit replacement may transfer prompt ownership from the old tab to the replacement.
- Durable command idempotency keys remain deduplicated even after failed/cancelled terminal outcomes during retention, preventing command storms.
- Lane/branch/role metadata survives fallback-to-stable identity migration and crash replacement.

## Reuse / ownership boundary

Owned component:
- `extension/components/tab-launch-guard/controller.js`
- command-executor/background wiring needed to consume the component
- focused component/queue tests and browser E2E fixtures.

Existing substrates reused rather than duplicated:
- Chrome tabs/storage/tabGroups APIs;
- Durable Command Queue;
- project registry and identity migration;
- existing content actuator/composer path;
- existing Response Completion and Message Delivery recovery components;
- existing release/security/browser gates.

No runtime dependency or third-party service was added.
## Validation on exact implementation SHA

- focused Tab Launch Guard + Durable Queue suite: **15/15 PASS**;
- full `npm test`: **77/77 PASS**;
- `npm run check`: PASS;
- browser E2E: PASS, including:
  - URL sanitization + rate-limit detection;
  - crash reload + continue;
  - crash replace + project/lane restore + continue;
  - bounded crash-recovery halt;
  - single-delivery ownership across duplicate create commands;
  - existing response-completion, delivery-timeout, retry, project-console, grouping and command gates;
- security policy: PASS, **28 production files / zero runtime dependencies**;
- `npm run prod-smoke`: PASS;
- `npm audit --omit=dev`: **0 vulnerabilities**;
- PowerShell parser: **6/6 PASS**;
- exact commit diff check: PASS.

## Live safety state during rollout

Both configured project orchestrators were temporarily set `enabled:false` and all pre-existing active commands were drained/cancelled before rollout. This prevents the old extension runtime from generating new tab/request storms before the new guard is integrated and reloaded. Existing working chats were not closed.
## Release boundary / exact next action

This lane does not merge `main`, tag Production, or close Issue #3.

On `integration/reuse-completion-v1`, reconcile GitHub/local first, consume exact implementation candidate `99e0054cd27b9fad3eaaee950dad87b2040c47ae`, run the complete integration gate set without fail-fast, and push only an exact green integration candidate.

After that exact integration candidate is live locally, reload the unpacked extension once. Verify that the new content/service-worker runtime contains `ChatSentinelTabLaunchGuard`, `ChatSentinelMessageDeliveryRecovery`, and `ChatSentinelResponseCompletion`. Only after runtime verification should the project orchestrators be re-enabled and normal autonomous execution resume.
