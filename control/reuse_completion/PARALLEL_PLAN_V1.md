# ChatSentinel v1.2 Reuse Completion — Parallel Plan

Baseline: `da1ef1e037151fcb827df0d5c1af1fe6444bc2e7`
Integration branch: `integration/reuse-completion-v1`

## Lanes

1. **R — Research / Reuse Audit**
   Branch: `research/reuse-audit-v1`
   Goal: exhaustive OSS/plugin capability inventory, license classification, direct-adapt vs clean-room decisions, exact reusable algorithms/components, test gaps.
   Writes: `docs/`, `control/reuse_completion/research/`, license/provenance only.

2. **C1 — Session / Tab Restore**
   Branch: `feat/session-restore-v1`
   Goal: persistent project tab-group snapshots, browser-restart restore, selective restore, retention, project switching.
   Owns: new session/snapshot modules plus focused tests; avoid queue/search/audit UI.

3. **C2 — Durable Operation Queue**
   Branch: `feat/durable-queue-v1`
   Goal: persisted retryable operation queue, resume after rerender/restart, progress/stop status, idempotency-aware execution.
   Owns: queue/executor modules and tests; do not implement session restore/search UI.

4. **C3 — Search / Export / Import**
   Branch: `feat/search-export-v1`
   Goal: project/chat search and filters, portable project config + recovery snapshot export/import, validation and preview-before-apply.
   Owns: search/export/import modules and focused UI/tests.

5. **C4 — Audit / History / Folder UX**
   Branch: `feat/audit-folders-v1`
   Goal: action/recovery history UI, nested project/folder organization, attribution-safe UX adaptation.
   Owns: audit/history surfaces and project tree UX; avoid session/queue/search internals.

## Integration protocol

- One chat per lane; each chat works only on its branch.
- Complete tests even after first failure and report all failures.
- Fix-forward inside lane scope, then revalidate.
- No lane merges directly to `main`.
- Integration branch serially unions green lane candidates and runs the full release gate after each union.
- GitHub + latest non-superseded handoff remain source of truth; prompts are not trusted without reconciliation.
- Final Production tag is forbidden until Issue #3 reuse-completion acceptance is fully closed.
