# ChatSentinel v1.2 Reuse Audit v1

Status: COMPLETE RESEARCH CANDIDATE
Lane: R — Research / Reuse Audit
Baseline: `da1ef1e037151fcb827df0d5c1af1fe6444bc2e7`
Integration lineage inspected: `integration/reuse-completion-v1`
Issue gate: #3 remains open; this document does not authorize Production tagging or main merge.

## Decision rules

1. Prefer Native Chrome / existing ChatSentinel components before new code.
2. Direct adaptation is allowed only from sources with a clear compatible license and pinned provenance.
3. If license is absent, unclear, copyleft-incompatible, or source reuse adds more coupling than value, use behavior-level clean-room reimplementation only.
4. No audited project becomes a runtime dependency. ChatSentinel must remain local-first and independently operable.
5. Component-First applies: adapted behavior must land behind an explicit component contract, owned state boundary, adapters, focused tests, and failure injection.

## High-value direct-adapt sources

| Source | Pinned revision | License | Decision | Highest-value reusable capability |
|---|---|---|---|---|
| `dyemane/tab-groups` | `4e73f6328b4b4201edf0011d63bee578d7884b60` | MIT | DIRECT-ADAPT | project tab-group capture/restore/switch, debounced auto-save, versioned import/export, search/diff |
| `BF-GO/session-backups` | `5980a58102c95b56bdd31e8bbfee580f293a73e3` | MIT | DIRECT-ADAPT | automatic/change snapshots, selective restore planning, retention, strict import validation, safe migration |
| `yurtools/gpt-conv-manager-chrome` | `8b7e7c55f4e72f186e90eab6fd288e0ee7e6da51` | MIT | DIRECT-ADAPT SELECTIVELY | project/chat discovery, local filter/sort, rate-limit-aware sequential bulk operations, stop/status patterns |
| `Sami21234/Chatgpt-Sidebar` | existing v1.1 provenance | MIT | ALREADY ADAPTED | in-page collapsible/resizable console interaction |
| `GoogleChrome/chrome-extensions-samples` | existing v1.1 provenance | Apache-2.0 | ALREADY ADAPTED | native `tabs.group` + `tabGroups.update` pattern |
## Clean-room / reference-only sources

| Source | Observed licensing state | Decision | Behavior worth reproducing independently |
|---|---|---|---|
| `kayuling/chat-organizer-extension` | no clear repository license surfaced in audit | CLEAN-ROOM | persisted queue, rerender resume, sequential bulk move/delete, final clean reload |
| `hiuxia/chatgpt-conversation-archive` | no clear repository license surfaced in audit | CLEAN-ROOM | nested local folders, local cache, portable Markdown/ZIP export workflow |
| `benedyktdryl/gpt-organizer` | no clear repository license surfaced in audit | CLEAN-ROOM | import-plan preview/apply, persistent audit logs, batch move/delete workflow |
| `xcanwin/KeepChatGPT` | GPL-2.0 lineage already documented | BEHAVIOR ONLY | interruption/retry state-machine ideas only; no GPL source reuse |
| `dizzpy/ChatGPT-Auto-Continue` | README declares MIT but no standalone LICENSE was confirmed in this audit | REFERENCE ONLY | selector/retry behavior is trivial; clean-room implementation is lower-risk |
| `boringresearch/plugin-chatgpt-automation` | no clear license previously identified | REFERENCE ONLY | prompt/work queue concepts only |

## Exact reusable algorithms / component mappings

### C1 — Session / Tab Restore

From `dyemane/tab-groups`, adapt the data flow rather than its UI: capture live `tabGroups`, enumerate tabs per group, normalize title/color/collapsed/tab URL state, persist a project snapshot, and restore by creating tabs then regrouping. Its project-switch transaction uses a switching guard around close-current → restore-target so group-change listeners do not auto-save a half-switched state.

From `BF-GO/session-backups`, adapt the stronger safety model: normalize before persistence, deterministic content hash to suppress duplicate automatic snapshots, retention after validated write, pure selective-restore planning before Chrome API calls, URL-scheme filtering, and partial-failure results that preserve successful work.

Required ChatSentinel divergence: identity must bind to ChatSentinel project/conversation records rather than rely only on Chrome group IDs, because group IDs are ephemeral across restart. Restore must be idempotent and must not duplicate already-open project chats.

### C2 — Durable Operation Queue

Do not copy queue code from unlicensed sources. Reimplement the observed state machine against the already-green ChatSentinel Durable Command Queue: `pending → running → succeeded|retryable_failed|terminal_failed|cancelled`, with persisted cursor/attempt count, idempotency key, bounded retry/backoff, stale-target re-resolution, and explicit stop-after-current semantics.

The existing queue/executor remains the only command substrate. Project operations and recovery actions add typed commands; they do not create a second queue.
### C3 — Search / Export / Import

From `dyemane/tab-groups`, adapt pure search over saved project/group/tab metadata and versioned JSON export/import with structural validation. Preserve a preview phase before mutation. Deduplicate imports on stable ChatSentinel IDs, not title alone.

From `yurtools/gpt-conv-manager-chrome`, reuse only the local filter/sort and progressive discovery patterns that tolerate partially loaded ChatGPT sidebars. Backend/API-specific calls are not a stable contract and must not become a hard dependency.

Import must be schema-versioned, size bounded, parse/validate before preview, validate again before persistence, reject unsupported URL schemes, remap conflicting IDs, and leave the pre-import state intact on failure.

### C4 — Audit / History / Folder UX

Reimplement nested folders and preview-first organization independently. Folder metadata is local organization state and must never imply server-side ownership. Audit events should be append-oriented records with actor/source, command ID, project/chat target, before/after summary, result, retry lineage, and timestamp.

The audit UI may compose folder and action-history components but may not directly mutate queue/session/search internals.

## Installed/native capability audit

Native Chrome APIs (`tabs`, `tabGroups`, `storage`, `alarms`, `scripting`) cover the required runtime primitives and should remain the first-choice substrate. Existing ChatSentinel Durable Command Queue, browser executor, Conversation Window, recovery engine, project registry, and in-page Shadow DOM console are reusable internal components and must not be duplicated.

Installed development plugins/tools (GitHub, Remote Desktop Commander, Context7, NPMScan, Testifly, CodeRabbit and related review/diagnostic tooling) can improve research, test generation, dependency/security review, and browser validation, but none should be required at ChatSentinel runtime. Issue #3 acceptance item 7 therefore remains compatible with plugin-first development.

## Required test gaps before Issue #3 may close

1. Restart restore with Chrome assigning new tab-group IDs; assert no duplicate project chats.
2. Restore when some tabs already exist, one URL is unsupported, and one Chrome API call fails; assert partial success is explicit and retry is idempotent.
3. Automatic/change snapshot deduplication, debounce loss across MV3 worker suspension, retention boundaries, and pinned/manual snapshot protection.
4. Selective restore by window/group/tab plus stale conversation identity migration from `tab:<id>` to stable conversation ID.
5. Queue persistence across page rerender, browser restart and server restart; retry budget/backoff; cancellation; stale target replacement; duplicate command idempotency.
6. Search across projects/chats with partially loaded sidebar data, case/Unicode handling, deleted/stale records, deterministic sorting, and large local datasets.
7. Export/import round-trip, schema-version rejection/migration, malformed/oversized JSON, ID collision remap, preview-before-apply, replace/merge rollback on failure.
8. Audit log persistence, ordering, retry lineage, recovery attribution, bounded retention/export, and redaction of sensitive payloads.
9. Nested folder create/rename/move/delete with cycle prevention, orphan repair, drag/drop race handling, and no accidental ChatGPT server mutation.
10. Full recovery/security/E2E suite must collect all failures rather than fail-fast; component suites must be independently green before integration.
11. Provenance gate must assert every direct-adapt source has pinned revision, license file, notice entry, adapted paths, and no undeclared copied source.
12. No-runtime-dependency gate must verify extension/server startup and all recovery primitives work with every external plugin/service unavailable.

## Risks / rejection notes

- Do not adapt upstream UI frameworks or dependency stacks merely to obtain algorithms; ChatSentinel currently has zero npm runtime/development dependencies and should preserve that unless a separate approved decision changes it.
- Do not rely on ChatGPT private backend endpoints as a stable foundation; DOM/API discovery may be used as replaceable adapters with failure containment.
- Do not match restored Chrome groups solely by title; duplicate titles are legal. Stable ChatSentinel project/chat identity plus normalized URL is the safer reconciliation key.
- Do not allow auto-save listeners to persist intermediate switch/restore state; use a transaction/suppression guard.
- Do not treat upstream tests as acceptance evidence. Every reused algorithm needs ChatSentinel-owned focused tests plus integration/restart/failure-injection coverage.

## Lane conclusion

The Issue #3 capability set is reusable without introducing a third-party runtime dependency. C1 and C3 have strong MIT implementation references suitable for selective direct adaptation; C2 and C4 should mostly be clean-room compositions over existing ChatSentinel primitives. The remaining release risk is implementation and integration evidence, not absence of reusable designs.
