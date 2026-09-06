# ChatSentinel NextGen — Canonical Requirements Ledger

Status: ACTIVE / authoritative project requirement supplement
Normative workflow: Canonical Software Engineering Workflow v3.0.1
Project workflow: ChatSentinel Final Development Workflow v1.1
Target architecture: ChatSentinel Final Target Architecture and Execution Master v1.1

## R-001 Product boundary

ChatSentinel is a Desktop-first local/hybrid AI software-engineering control plane.
The final runtime is split into:

- ChatSentinel Desktop / Control Center: primary operator UI.
- ChatSentinel Core: durable orchestration, state, Git, validation, evidence and policy authority.
- ChatSentinel Browser Bridge: lightweight browser edge agent only.
- F6, RAG and Multi-AI Federation: feature-toggleable Core planes with advisory model authority.

The browser extension MUST NOT become the canonical project state store or full application.
Logical Lane MUST NOT equal a permanent browser tab.
One Project MUST have one canonical state; Groups are virtual views, not state silos.

## R-002 Strangler migration

The user reported v1.3.4 as not working correctly and temporarily returned to the v1.2 family.
Therefore v1.3.4 MUST NOT be used as trusted NextGen supervisor or working fallback.
Exact stable v1.2 reference: backup/v1.2.1-working-reference-20260906 @ 05d7370a43087845d806389f5ae867f81b82df73.
The current C:\\ChatSentinel worktree is observed mixed/dirty and MUST NOT be automatically reset, cleaned or treated as an exact rollback.
Until a replacement supervisor is independently GREEN, NextGen development uses Direct RDC + exact Git worktrees.
Strangler migration still applies to product code: preserve proven behavior and replace component-by-component; no big-bang rewrite.

## R-003 Direct-wave continuation / WAVEADV

In direct-wave mode, completion of workers may materialize a WAVEADV/continuation chat, but that
continuation lane is itself a supervised logical lane. Every later orchestration tick MUST inspect it.
A previously successful CREATE/SEND command or a deduplicated idempotency key MUST NOT silently stop
the continuation chain. WAVEADV must have deterministic command generations, idle/stall supervision,
recovery budgets, replacement semantics and an explicit completion/next-wave materialization contract.
## R-004 Lane Liveness, Lease & Recovery Controller

Every logical lane must have independent liveness and ownership state:

- liveness heartbeat (tab/agent alive signal), configurable ~10s default;
- progress heartbeat (tool/test/commit/push/file/evidence/handoff meaningful progress);
- process/tool heartbeat independent of browser tab;
- lane lease with owner_session, lease_epoch and lease_expires_at;
- monotonic fencing token/epoch for takeover;
- branch, worktree, last known HEAD and last progress identity bound to lease state.

Recommended state model:
`ACTIVE -> SUSPECT -> DISCONNECTED -> RECONCILING -> RECOVERING -> ACTIVE`, with BLOCKED when safety cannot be proven.
Thresholds are configurable; missing heartbeats alone are not destructive-authority evidence.

Before takeover/reassignment, Core MUST inspect process/tool activity, worktree ownership, git status,
dirty/untracked files, local/remote HEAD, active tests, locks, canonical handoff and intentional PAUSED state.
No reset/clean/delete of dirty work is allowed as automatic recovery.
When takeover advances epoch N -> N+1, a returning N owner is fenced from write/commit/push and may only report state.

## R-005 Page / Session Health Probe

Browser health decisions combine, rather than substitute, these signals:

- URL/tab/provider/chat identity;
- live DOM state;
- semantic/accessibility UI state where available;
- visible error/reconnect/retry/login/rate-limit text;
- generation state;
- last meaningful UI/DOM activity;
- DOM fingerprint/change age;
- browser/navigation/network state where available;
- raw HTML/page source as auxiliary evidence only;
- screenshot/visual probe when SUSPECT, contradictory, before takeover, after reconnect or during silent stall.

A screenshot is diagnostic evidence, never sole protected-action authority.
A browser tab may be technically alive but operationally STALLED; process/tool progress may prove that a visually idle page is still healthy.
## R-006 Browser resource virtualization

Core owns a bounded execution pool. Lanes transition Hot/Warm/Cold without losing canonical identity.
Reuse matching tabs/sessions before opening duplicates. Native tab discard may implement safe Warm state.
Chrome closed => browser work becomes WAITING_BROWSER while project/DAG/Git/evidence queues remain durable in Core.
CPU/RAM/browser pressure dynamically adjusts hot slots and concurrency; critical-path work receives priority without violating fairness.

## R-007 Desktop application and LiveBridge shell

Desktop is the final primary UI, not a temporary local web dashboard.
Initial host is Electron-first behind a host abstraction. The frozen LiveBridge Studio shell may be R2-adapted
for visual/navigation/layout/generic components only; LiveBridge backend/business authority is not imported.
Renderer has no unrestricted Node privilege; preload exposes narrow typed APIs with context isolation, CSP,
sender validation and secret isolation. Closing the window may leave Core running in tray/background mode.

## R-008 Exact development governance

Every Component follows Admission -> bounded authoring -> collect-all -> source freeze -> independent exact
validation -> readiness -> continuous Pack Integration Spine. Validator cannot patch source. Changed source creates
a new source identity and invalidates prior validation. No stale predecessor substitution or inferred authority.
Shared migration/collision resources are serialized; a free worker is not permission for unbounded WIP.

## R-009 F6 authority

F6 contains BugBrain, SecBrain, ArchBrain, TestBrain/GateForge, AlgoBrain, OpsBrain, DataBrain and PerformanceBrain.
Brain/provider/RAG outputs are advisory and schema-constrained. Structured output validation + normalizer provenance/loss
checks produce a ProjectManifest. Only deterministic policy/Judge logic may issue protected verdict authority.
Canonical Judge verdicts are PASS | FAIL | NEED_HUMAN; READY/BLOCKED/MISSING_EVIDENCE are execution/evidence states.

## R-010 Specialized RAG / Engineering Memory

Do not use one generic noisy RAG. Knowledge is separated by task-aware domains including Security, Database,
Bug/Failure, Performance/Reliability, Frontend/UI, DevOps/Deployment, AI/RAG/Prompt, Product/UX and
Architecture/Contracts where useful. Knowledge Packs are versioned, immutable per version, checksum-pinned and
provenance-aware. Retrieval results enter ContextPack only. Memory is advisory until verified against current code,
architecture, policy and evidence.
## R-011 Multi-AI Federation

Federation supports browser, API and local adapters behind replaceable contracts. Provider records include
capabilities, health, quota/rate-limit, cost, session pool, isolation and terms policy. Providers never gain
canonical authority. ChatGPT Browser Adapter and Local/OpenAI-compatible Adapter are initial mandatory framework paths;
Claude/Gemini/Grok/Perplexity are optional provider Components gated by their own reuse/terms/validation evidence.

## R-012 Canonical persistence and zero-context recovery

No critical fact may exist only in a chat. Persist project truth in local source and GitHub through:
`control/nextgen/CANONICAL_STATE.json`, exact evidence receipts, `spec/SPEC_INDEX.yaml`,
`REQUIREMENTS_LEDGER.md`, DAG/frontier artifacts, Git SHA/tree identities and canonical handoffs.
Persistent ChatGPT Files Library `/ChatSentinel/NextGen` is an additional mirror, never the only project truth.
A future independent AI/account must reconstruct status from repository + exact artifact hashes without prior memory.
Document hash/size/integrity mismatch blocks full-spec verdicts.

## R-013 Runtime truth model

Terminal Core uses transactional runtime state + transactional outbox + append-only hash-chained Event Journal +
canonical portable evidence/Git promotion. Meaningful transitions use globally unique transition_id plus correlation_id,
causation_id, entity identity, prior/new state, DAG epoch and payload hash. Runtime DB is not sole canonical truth.

## R-014 Reuse-first

Before Build New, search native capability, installed plugins/tools, current ChatSentinel code, internal Radlina code,
public repositories/registries and reference implementations. Decisions use R0 exact reuse through R5 build new.
Direct reuse requires exact pin, license, security/supply-chain, quality, maintenance, performance, provenance and
ChatSentinel-owned tests. Existing working queue/recovery/project/session behavior must be evolved, not casually rewritten.

## R-015 Terminal acceptance

ChatSentinel terminal target is EP2/L5. Mandatory Automation Coverage and mandatory Governance Enforcement must be
100% GREEN from evidence, not hand-declared. Enabled optional target capabilities must also be GREEN; disabled optionals
must be explicit N/A_OPTIONAL_DISABLED. Acceptance does not imply production/external activation authority.

---

This ledger is additive to the hash-pinned project workflow/architecture. A Project Profile may strengthen it but may not
weaken Universal Core invariants. Conflicts are resolved by the authority order in `control/nextgen/spec/SPEC_INDEX.yaml`.
