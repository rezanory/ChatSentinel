# ChatSentinel Workflow Continuation V1

ChatSentinel projects may define a durable project-level workflow in addition to the currently active lane set. The workflow prevents completion of one parallel wave from being mistaken for completion of the whole project.

## Core rule

`all current lanes complete` means **stage complete**, not **project complete**.

A project is complete only when its workflow completion contract is satisfied. The primary completion contract is `terminalStageId`.

## Recommended source

Store the machine-readable workflow inside the governed project repository:

`control/chatsentinel-workflow.json`

The watchdog reloads this file on orchestration ticks. This lets a governance/planning lane extend the future workflow without changing ChatSentinel runtime code.

## Runtime state

ChatSentinel persists only continuation state such as `currentStageId`, `completedStageIds`, and `completedAt`. When `sourcePath` is configured, stage definitions continue to come from the project repository.

## Transition behavior

When required lanes are incomplete, normal NEXT/FIX/REPLACE recovery continues. If a stage defines an `integrationLane`, that integration lane is part of stage completion and must also become green.

When a stage becomes green:

- If another stage exists, ChatSentinel records the stage as complete, activates the next stage, and immediately queues up to `maxParallelLanes` required lanes from that stage.
- If the completed stage is `terminalStageId`, ChatSentinel records durable workflow completion.
- If no next stage exists but the terminal stage has not completed, ChatSentinel must not report project completion.
- If a `plannerLane` exists in that last case, ChatSentinel creates a workflow-review lane to reconcile canonical roadmap/handoffs and extend the manifest.
- Without a planner lane, the project becomes `BLOCKED` with explicit `workflow-goal-incomplete-no-next-stage` evidence rather than silently stopping.

## Safety

Workflow source paths must resolve inside the project repository. Runtime execution does not infer missing stages by guessing. Missing workflow materialization is surfaced as a governance gap or delegated to the configured planner lane.

## Canonical roadmap profiles

A project may opt into an explicit canonical roadmap profile through `workflowProfileId` on `/orchestrator/configure`. The profile is compiled read-only from exact immutable Git refs; ChatSentinel never checks out, rewrites, or advances the governed project while compiling the plan.

The compiler validates repository identity, declared pack/component denominators, pack-to-component membership, DAG nodes, DAG edges against `predecessor_components`, per-phase wave counts, total denominators, and the declared terminal phase. Any mismatch fails closed.

The v1.3 profile `rezanory/chat-project:ph7-ph10.5:v1` freezes 49 Packs, 162 Components and 76 topological waves from PH-7 through PH-10.5. Its terminal stage is `PH10.5-W22` and runtime parallel launch is bounded to 8 lanes per transition.

## Exact stage baseline chaining

A future wave does not inherit a guessed baseline. After the current implementation lanes and its integration lane are green, ChatSentinel records the exact green integration head in durable `stageBaselines`, binds that SHA to every lane in the next stage, and includes the SHA in `CREATE_LANE_CHAT` command and project-membership metadata.

If a workflow is resumed at a stage whose exact baseline evidence is unavailable, the lane contract is incomplete and orchestration is explicitly `BLOCKED`; it must not launch work with an empty or inferred baseline.

## Parallelism and admission boundaries

Topological waves use only canonical component dependencies. A wave wider than `maxParallelLanes` is not truncated: the bounded subset is queued immediately and remaining required lanes stay active in the stage for later orchestration ticks.

The profile does not infer cross-phase runtime admission from old materialization flags or prose-only predecessor descriptions. Intra-phase DAG parallelism is automatic; any additional cross-phase overlap must be supported by explicit current governance/admission evidence and materialized through the governed workflow/replan path rather than guessed by runtime code.
