# R Lane Handoff — Research / Reuse Audit v1

Status: GREEN RESEARCH CANDIDATE
Repository: `rezanory/ChatSentinel`
Branch: `research/reuse-audit-v1`
Baseline: `da1ef1e037151fcb827df0d5c1af1fe6444bc2e7`
Scope: docs, `control/reuse_completion/research/`, license/provenance only.

## Reconciliation

- Local branch and `origin/research/reuse-audit-v1` were clean and exactly at the requested baseline before edits.
- Newer control lineage was found on `origin/integration/reuse-completion-v1`; mandatory `docs/CANONICAL_HANDOFF.md`, `control/COMPONENT_FIRST_DEVELOPMENT_RULE.md`, and `control/reuse_completion/PARALLEL_PLAN_V1.md` were read from that reconciled lineage.
- GitHub Issue #3 was read directly and remains OPEN. No Production tag/main merge is authorized.

## Materialized outputs

- `control/reuse_completion/research/REUSE_AUDIT_V1.md`
- `control/reuse_completion/research/PROVENANCE_MANIFEST_V1.json`
- `docs/SOURCE_INVENTORY.md` v1.2 additions
- `THIRD_PARTY_NOTICES.md` v1.2 additions
- MIT license copies for `dyemane/tab-groups`, `BF-GO/session-backups`, and `yurtools/gpt-conv-manager-chrome`

## Decisions

Direct-adapt: pinned MIT sources `dyemane/tab-groups`, `BF-GO/session-backups`, and selected `yurtools/gpt-conv-manager-chrome` patterns. Clean-room/reference only: unlicensed/unclear sources plus GPL KeepChatGPT; Auto-Continue remains reference-only despite README MIT declaration because a standalone license file was not confirmed and the behavior is trivial to reimplement.

C1 should selectively adapt the strongest restore/snapshot algorithms; C3 should selectively adapt search/import/export/discovery patterns. C2 and C4 should primarily compose clean-room behavior over existing ChatSentinel queue, executor, registry and UI primitives. No external runtime dependency is introduced.
## Validation — collect all failures

Executed independently rather than fail-fast:

- `npm test`: PASS, 32/32.
- `npm run check`: PASS.
- `npm run policy-check`: PASS; 17 production files, zero runtime dependencies.
- `npm run prod-smoke`: PASS.
- `npm run security-audit`: PASS; 0 vulnerabilities.
- provenance manifest JSON parse: PASS.
- `npm run e2e`: first attempt hit a transient fixed-port/parallel-browser collision (`4318/4320`) while another run owned the listeners; the suite was not treated as green. After listener ownership cleared, the full rerun passed detector/recovery 7/7, actuator cases, project console, native tab grouping, and chat focus/open.

No code was changed to mask or bypass that transient. Full final E2E rerun is PASS.

## Test gaps handed to implementation/integration lanes

The audit enumerates restart ID churn/no-duplicate restore, partial restore failure/idempotency, snapshot dedupe/retention/MV3 suspension, selective restore + identity migration, durable queue restart/rerender/cancel/backoff/stale target, large/partial search, import rollback/versioning/ID collisions, audit retention/redaction, nested-folder cycle/orphan races, provenance enforcement, and plugin/service-offline runtime acceptance.

## Next action

Integration controller may consume this research candidate as documentation/provenance evidence, then require each C1–C4 implementation handoff to declare which audited patterns were actually adapted and the exact owned paths. Do not close Issue #3 until all independent acceptance and full integration gates pass.
