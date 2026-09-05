# ChatSentinel Workflow Continuation V1

ChatSentinel can supervise a durable multi-stage workflow for any attached project. Project-specific roadmap data belongs to that project's own repository; ChatSentinel owns only the generic continuation engine.

## Core rule

`all current lanes complete` means **stage complete**, not **project complete**.

A project is complete only when its declared workflow completion contract is satisfied. The primary contract is `terminalStageId`.

## Project-owned source

The recommended machine-readable manifest is stored by the governed project itself:

`control/chatsentinel-workflow.json`

The watchdog reloads that file on orchestration ticks. ChatSentinel does not embed another repository's phases, components, DAG, branches, SHAs, or roadmap records in its own source tree.

## Runtime state

ChatSentinel persists continuation state such as `currentStageId`, `completedStageIds`, `stageBaselines`, and `completedAt`. When `sourcePath` is configured, stage definitions remain project-owned.
## Transition behavior

When required lanes are incomplete, normal NEXT/FIX/REPLACE recovery continues. If a stage defines an `integrationLane`, that lane is part of stage completion and must become green too.

When a stage becomes green:

- if another stage exists, ChatSentinel records the current stage complete and activates the next one;
- it immediately queues up to `maxParallelLanes` required lanes;
- unqueued required lanes remain active for later ticks rather than being truncated;
- only the declared `terminalStageId` may produce durable project completion;
- if no next stage exists before the terminal contract is met, ChatSentinel returns `REPLAN` when a planner lane exists, otherwise `BLOCKED`.

## Exact stage baseline chaining

A later stage never receives a guessed Git baseline. When the current stage's integration lane is green, its exact remote head is stored in `stageBaselines`, bound to the next stage, and propagated through `CREATE_LANE_CHAT` metadata.

If required baseline evidence is missing, the lane contract remains incomplete and work is not launched as if the baseline were known.

## Safety boundary

Workflow source paths must resolve inside the attached project's own repository. ChatSentinel does not compile or carry a second repository's roadmap. Missing project roadmap materialization is surfaced to the project's planner/governance workflow instead of being invented by ChatSentinel.
