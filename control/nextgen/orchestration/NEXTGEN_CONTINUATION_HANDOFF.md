# ChatSentinel NextGen — Supervised Continuation Handoff

Status: `READY_TO_MATERIALIZE_ADMISSIONS`  
Wave: `NEXTGEN-WAVE-0002`  
Project: `project:chatsentinel-nextgen`  
Repository: `rezanory/ChatSentinel`

## Exact reconciliation

- Canonical trunk: `feat/nextgen-ep2-l5-v1`
- Controller branch: `orchestration/nextgen-continuation-v1`
- Dedicated worktree: `C:\Users\Radlina\workspace\chatsentinel-nextgen-orchestration`
- Reconciled local/remote HEAD: `ce71e37fa2c5f3854104df4985ec54739450b8f0`
- Reconciled tree: `10554c301355c13f470d8636186532e9f5271162`
- Working tree at reconciliation: clean
- Normative workflow: Canonical Software Engineering Workflow v3.0.1
- Workflow SHA256: `cf74c19b44f7b0230dba9ee6b045de2a1a953168ae142b7b8af51312ad9d4b07`
- Working supervisor fallback remains `backup/v1.3.4-working-20260906` @ `874112cff9d77837f93cdd616abe620d1aa2e4dd`, tree `05acb3a515206b5ed24e0be48b406b830b715a31`.

No main merge, Production activation, provider side effects, or authority widening is authorized by this handoff.

## Exact predecessor evidence
- PH00 bootstrap verdict: `READY_FOR_EXACT_SUCCESSOR_ADMISSION`.
- PH00-P01-C02 is `READY_AS_BOOTSTRAP_PREDECESSOR` for C06.
- PH00-P02-C04 is `READY_AS_BOOTSTRAP_PREDECESSOR` for C07.
- PH01-P02-C05 ModuleRegistryFeatureToggle is independently exact-green and integrated.
- C05 exact source: `d9dd64783af37cb99eb4d6da1352b2ae1e126c1c`, tree `b133e73a40ac7b781ff9805ccdedb5d0ec146d5f`.
- C05 validation receipt: `a511eafba34e1f6fd51cb1d77a2d969326f67de3`, verdict `GREEN`.
- C05 readiness: `c0d3ee56d276bc4defe3855f07a98d0373db069e`, authority `CONSUMABLE_BY_EXACT_SUCCESSORS`.
- Component Registry v1.1 SHA256: `dda74665e78a5f750befb2bc482842c3673f66f8e137c40b9c9fd2cb8dac7c47`.
- Initial DAG v1.1 SHA256: `1b6890fa061dd6498ba07e27576be5902c0355b036b4d585e5618693665a8667`.
- Library registry file id: `file_0000000011b881f49c1a7ab07081253b`.
- Library DAG file id: `file_00000000c6e081f49d6690cb6c7a9ed7`.

The exact registry and DAG confirm C06 direct predecessors are C05 + PH00-P01-C02, while C07 direct predecessors are C05 + PH00-P02-C04. C06 and C07 have no dependency edge between them.

## Maximum-safe frontier

Canonical `governance` WIP is 1. Therefore the independent Admission evaluations are serialized, while their logical lanes may both be materialized.

1. `PH01-P02-C06 CoreProcessLifecycle`: Admission active in governance slot 1.
2. `PH01-P02-C07 TransactionalStateAdapter`: independent Admission lane materialized as `WAITING_WIP`.
3. C06 authoring lane: materialized/reserved but fenced as `WAITING_ADMISSION`.
4. C07 authoring lane: materialized/reserved but fenced as `WAITING_ADMISSION`.
5. `PH01-P01-C01 DesktopHostElectron`: admission/research may remain queued; no authoring while high-risk WIP capacity is unavailable.
6. `NEXTGEN-CTRL-WAVE-0002`: fresh required controller logical lane; it remains supervised on later ticks and is not complete merely because workers emitted prose-final.

## Reserved exact lanes

### C06 Admission
- Branch: `governance/ph01-p02-c06-admission-v1`
- Worktree: `C:\Users\Radlina\workspace\chatsentinel-nextgen-c06-admission`
- Scope: independent exact Admission only; verify hash-pinned component specification, sizing/reuse/risk/contract and direct predecessors.
- Baseline: reconciled canonical trunk `ce71e37fa2c5f3854104df4985ec54739450b8f0`.
- On PASS: freeze canonical Admission decision/handoff; no source authoring in this lane.

### C06 Authoring
- Branch: `feat/ph01-p02-c06-core-process-lifecycle-v1`
- Worktree: `C:\Users\Radlina\workspace\chatsentinel-nextgen-c06`
- Initial state: `WAITING_ADMISSION`.
- Source authority begins only from the exact C06 Admission PASS identity and its declared baseline/contract/risk bounds.

### C07 Admission
- Branch: `governance/ph01-p02-c07-admission-v1`
- Worktree: `C:\Users\Radlina\workspace\chatsentinel-nextgen-c07-admission`
- Scope: independent exact Admission only; verify hash-pinned component specification, sizing/reuse/risk/contract and direct predecessors.
- Initial state: `WAITING_WIP` until governance slot is free.

### C07 Authoring
- Branch: `feat/ph01-p02-c07-transactional-state-adapter-v1`
- Worktree: `C:\Users\Radlina\workspace\chatsentinel-nextgen-c07`
- Initial state: `WAITING_ADMISSION`.
- Source authority begins only from the exact C07 Admission PASS identity and its declared baseline/contract/risk bounds.

### C01 Admission / research reserve
- Branch: `governance/ph01-p01-c01-admission-v1`
- Worktree: `C:\Users\Radlina\workspace\chatsentinel-nextgen-c01-admission`
- Scope: admission/reuse research only until controller proves high-risk WIP capacity.
- No DesktopHostElectron source authoring is authorized by this wave handoff.

## Required supervision invariants

- Reuse the working v1.3.4 queue/recovery/orchestration supervisor under strangler migration; do not rewrite it from zero.
- Direct-wave `WAVEADV` is itself a supervised logical lane. Later ticks must inspect it; CREATE/SEND success or idempotency dedupe may never silently terminate continuation.
- Every logical lane requires liveness heartbeat, progress heartbeat, process/tool heartbeat, lease owner/session, expiry, monotonic fencing epoch and branch/worktree/HEAD binding.
- No blind takeover. Before recovery/takeover, inspect process activity, worktree ownership, dirty/untracked state, local/remote HEAD, active tests/locks, handoff and intentional PAUSED state.
- A returning owner from an older fencing epoch is read-only for write/commit/push authority.
- Page/session health is multi-signal: identity, DOM, semantic/visible text, generation, activity/change age, browser/network state, raw source auxiliary evidence and screenshot when suspect/contradictory/before takeover/after reconnect/silent stall.
- Screenshot evidence is diagnostic only; it is never sole protected-action authority.
- Logical Lane is not a permanent tab. Tabs/sessions are disposable execution surfaces bound to durable Core lane identity.
- Desktop main UI is primary operator surface; Core owns durable canonical authority; Browser Bridge remains lightweight.
- F6/RAG/provider/model outputs are advisory and schema-constrained; only deterministic policy/Judge logic may issue protected verdict authority.
- Candidate/frontier/queue state is never authority. Exact Admission -> bounded authoring -> source freeze -> independent validation -> readiness/integration remains mandatory.

## Controller continuation contract

The controller must not advance this orchestration branch merely because a worker UI is idle or a chat returns a final answer. On each later tick it must reconcile GitHub/local, inspect lane heartbeat/lease/fencing/process/page signals, verify exact receipts, and then derive the next maximum-safe frontier from canonical DAG evidence.

When C06 Admission passes, C06 authoring may become active and the governance slot may advance to C07 Admission. When C07 Admission passes, C07 authoring may become active if authoring/resource limits permit. Any failed or incomplete Admission remains fenced and must be fix-forwarded in its governance lane; no inferred authority is allowed.

A wave is complete only when every required lane has deterministic canonical evidence and a next-wave controller/continuation lane is materialized. Idempotency dedupe must suppress duplicate side effects, not suppress required future continuation generations.
