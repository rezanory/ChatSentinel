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
