# ChatSentinel NextGen â€” Supervised Continuation Handoff

Status: `ACTIVE_DIRECT_RDC_FRONTIER`
Wave: `NEXTGEN-WAVE-0003`
Project: `project:chatsentinel-nextgen`
Repository: `rezanory/ChatSentinel`

## Canonical reconciliation

The controller started from exact baseline `ce71e37fa2c5f3854104df4985ec54739450b8f0` / tree `10554c301355c13f470d8636186532e9f5271162` and initially materialized `NEXTGEN-WAVE-0002` on the orchestration branch. During execution, canonical trunk advanced independently and is now authoritative at:

- canonical trunk: `feat/nextgen-ep2-l5-v1`
- canonical trunk HEAD: `0ae086059fd4e3fcb26765f8795fb8ae74b69b74`
- canonical trunk tree: `d83179761e4b542981c62cb0c5d1f718da941bc3`
- orchestration branch prior pushed controller commit: `fcb8514a30bca18e0f46a386cc06f1ade4801ee5`
- normative workflow: Canonical Software Engineering Workflow v3.0.1
- workflow SHA256: `cf74c19b44f7b0230dba9ee6b045de2a1a953168ae142b7b8af51312ad9d4b07`

The newer canonical trunk supersedes the earlier assumption that v1.3.4 is the working NextGen supervisor.

## Runtime supervision policy â€” authoritative R-002

- v1.3.4 MUST NOT be used as trusted NextGen supervisor or working fallback.
- stable rollback-family exact reference: `backup/v1.2.1-working-reference-20260906` @ `05d7370a43087845d806389f5ae867f81b82df73`, tree `f6163b7b8d3e46335e91adc5b7e5528e5f136593`.
- `backup/v1.3.4-working-20260906` @ `874112cff9d77837f93cdd616abe620d1aa2e4dd` is retained for forensics/reference only.
- current `C:\ChatSentinel` is mixed/dirty and MUST NOT be reset/cleaned automatically.
- until a replacement supervisor is independently GREEN, NextGen supervision is `DIRECT_RDC_PLUS_EXACT_GIT_WORKTREES`.
- evidence: `control/nextgen/evidence/legacy-runtime/ROLLBACK_STATE_20260906.yaml`.

A legacy `/orchestrator/configure` attempt made before this concurrent trunk advancement was detected has been disabled. The project is back to `orchestration.enabled=false`. A superseded controller chat creation completed before cancellation; a bounded `CLOSE_CHAT` cleanup command was issued. No authority from that stale prompt is accepted.

## PH01-P02-C06 exact Admission

C06 is no longer merely a frontier hint. Its independent Admission lane is clean/reconciled local+remote at:

- component: `PH01-P02-C06 CoreProcessLifecycle`
- Admission branch: `governance/ph01-p02-c06-admission-v1`
- Admission decision commit: `e347978f75ff3e9488728f006a53c9ba9f444b31`
- latest reconciled Admission head: `f7e464068e50a0d3a924365879f7821c82e40cf0`
- latest reconciled Admission tree: `4c4f7559d14cceb2102dc6f290809a167c40e18d`
- exact admission baseline: `ce71e37fa2c5f3854104df4985ec54739450b8f0`
- decision: `ADMITTED_FOR_BOUNDED_AUTHORING`
- authority file: `control/nextgen/admissions/PH01-P02-C06.yaml`

The admission freezes HIGH risk and authorizes only:

- `src/core/bootstrap/**`
- `test/core-process-lifecycle.test.js`
- `control/nextgen/evidence/PH01-P02-C06/**`

It requires R2 adapt/extend of existing lifecycle behavior, no queue/recovery/orchestrator rewrite, no Electron/renderer, no SQLite migration, no browser/provider logic, no package manifest mutation, and no implicit process-exit authority.

## Maximum-safe frontier now

1. `PH01-P02-C06 CoreProcessLifecycle` â€” bounded authoring ACTIVE under exact Admission `e347978fâ€¦`; consumes one authoring slot and one HIGH-risk slot.
2. `PH01-P02-C07 TransactionalStateAdapter` â€” independent exact Admission ACTIVE in the single governance slot; source remains fenced.
3. `PH01-P02-C07` authoring â€” reserved `WAITING_ADMISSION` only.
4. `PH01-P01-C01 DesktopHostElectron` â€” admission/reuse research queued; no authoring until exact Admission and high-risk capacity permit.
5. `NEXTGEN-CTRL-DIRECT-RDC-WAVE-0003` â€” required logical controller obligation executed through the current Direct RDC session, not through legacy v1.3.4 runtime automation.

C06 and C07 remain dependency-independent in the hash-pinned DAG: C06 predecessors are C05 + PH00-P01-C02; C07 predecessors are C05 + PH00-P02-C04. C07 later unlocks C08/C09; C06 participates in the later C10 fan-in.

## Required continuation invariants

- Direct-wave `WAVEADV` remains a supervised logical-lane contract in the target design. Idempotency dedupe may suppress duplicate side effects, never a required later continuation generation.
- Every logical lane requires independent liveness heartbeat, progress heartbeat, process/tool heartbeat, lease owner/session, lease expiry, monotonic fencing epoch, and branch/worktree/HEAD binding.
- No blind takeover: inspect process/tool activity, worktree ownership, dirty/untracked files, local/remote HEAD, tests/locks, canonical handoff and intentional PAUSED state first. Returning stale-epoch owners are read-only.
- Page/session health is multi-signal: URL/identity, live DOM, semantic/visible text, generation state, activity/change age, browser/network state, raw source auxiliary evidence, and screenshot when suspect/contradictory/before takeover/after reconnect/silent stall. Screenshot is diagnostic only.
- Logical Lane is not a permanent tab. Tabs/sessions are disposable execution surfaces; Core owns durable lane identity.
- Desktop is the primary operator UI; Core owns durable state/Git/validation/evidence/policy authority; Browser Bridge remains lightweight.
- F6/RAG/provider/model outputs are advisory and schema-constrained. Only deterministic policy/Judge logic may issue protected verdict authority.
- Candidate/frontier/queue/runtime state is never authority. Exact Admission -> bounded authoring -> source freeze -> independent exact validation -> readiness/integration remains mandatory.
- Strangler/reuse-first still applies to product code even though v1.3.4 is not trusted as supervisor: preserve proven queue/recovery/project/session behavior and evolve component-by-component.

## Execution boundaries

No main merge, production/external activation, provider side effects, migration authority, traffic/flag enablement, destructive reset/clean, or authority widening is granted by this handoff.

The next deterministic controller action is to execute C06 bounded authoring and C07 independent Admission under Direct RDC + exact Git worktrees, then freeze evidence/receipts and derive the next maximum-safe frontier from the repository again. Prose-final or browser-idle is not completion evidence.


## Reliability / continuation floor added by canonical trunk `0ae0860`

- `stable/v1.2.1` is a behavioral reliability floor, not architecture authority. Equivalent core-loop behavior may not regress below it.
- Logical objective completion is distinct from command execution, generation and dedupe. `objective_id`, generation/attempt identity, terminal predicate and next-action predicate remain independently supervised.
- `SILENT_PROJECT_STOP` is a critical failure: a non-terminal project with no proven blocker and safe admissible work must expose bounded actionable progress.
- Protected automation requires Core/Desktop/Browser Bridge/runtime version and protocol coherence; mixed-version drift blocks authority.
- The terminal orchestrator stays thin: DAG scheduling, liveness, leases/fencing, command/idempotency, recovery, Git reconciliation, validation/integration and continuation remain explicit subsystem contracts.
