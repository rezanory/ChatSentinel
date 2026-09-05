# Integration Controller component

Responsibility: safely turn exact green lane candidates into one exact green integration-spine candidate without owning Git execution, recovery implementation, or the durable command queue.

## Public contract

Create the component with `createIntegrationController({ git, gateRunner, recovery, queue, logger })` and call `run(input)`.

Required Git substrate methods:
- `inspectSpine()`
- `unionCandidate()`
- `rollback()`
- `freezeCandidate()`

Optional Git substrate methods are `createCheckpoint()`, `isAncestor()`, and `withExclusiveIntegrationLease()`.

`gateRunner.run(name, context)` executes each gate. The controller always runs the complete gate list and never stops after the first failure.

Recovery is injected through `classifyFailure`, `fixForward`, and `requestLaneFix`; the controller does not duplicate recovery logic.

Next-lane materialization is injected through `queue.enqueueNextLane()` and receives a deterministic idempotency key bound to the frozen integration SHA.

## Safety invariants

- Required lane candidates must be green, handoff-bound, advanced beyond baseline, and exact when local/remote heads are supplied.
- The integration worktree must be clean, reconciled, on the expected branch, and free of an in-progress Git operation before union starts.
- Candidate unions are serialized and use the injected Git substrate with `cherry-pick-range` intent.
- Union conflicts and failed/unclassified gates restore the captured integration checkpoint.
- Integration-owned failures may be fix-forwarded, but the entire gate set is rerun after each repair round.
- Lane-owned failures are routed back to the owning lane instead of being patched inside the controller.
- Freeze is accepted only when SHA/tree are exact and clean local/remote heads both equal the frozen SHA.
- A frozen green candidate is never rolled back merely because next-lane enqueue is temporarily unavailable.

## Ownership boundary

This component owns policy, sequencing, serialization, gate aggregation, rollback decisions, exact-candidate freeze validation, and next-lane handoff orchestration. It deliberately does not shell out to Git, implement retry/recovery internals, mutate shared command validation, merge `main`, close Issue #3, or tag Production.
