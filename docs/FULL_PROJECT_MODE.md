# ChatSentinel Full Project Mode

Canonical activation phrase:

`CHATSENTINEL FULL PROJECT MODE`

Meaning: use the canonical `full` profile from `config/project-profiles.json` for the current project and chat. Full Mode enables project auto-recovery and Chrome tab grouping while preserving session snapshots/selective restore, active-parallel-chat projection, conversation DOM compaction, search/export/import, audit/history, Component-First development, anti-blocker, Integration Controller, runner-on-demand, and release gates.

Use Component-First development. Parallelize only independent lanes. Reconcile Git/local/remote before acting. Maintain canonical handoff and anti-blocker evidence. Use the Integration Controller for serialized union and complete gates without fail-fast. Use a local/self-hosted runner when the project needs one and the authorized device provides it.

Completed or stale chats leave the active parallel view without deleting historical evidence. Do not merge `main`, close release issues, tag Production, or activate a release unless every required acceptance item and independent gate passes.

A project-specific instruction that follows the activation phrase overrides only that explicit detail; the rest of Full Project Mode remains active.

## One-click activation

The ChatSentinel panel exposes `Activate Full Project Mode`. Activation is a real project operation, not only a composer edit. It resolves the current attached project first, then an explicitly selected project, then an exact normalized local project-path match; if no safe selection exists it requires an explicit project path and creates a deterministic project identity from that path. Ambiguous state fails closed rather than attaching the chat to an arbitrary project.

On success the current ChatGPT chat is attached to the resolved project, project `autoRecovery` and `groupTabs` are enabled, the full canonical capability profile is persisted, the live project tabs are grouped, and an activation session snapshot is captured through the existing snapshot/restore substrate.

The existing prompt is preserved. The canonical phrase is prepended only after project activation succeeds, the prompt is never auto-sent by this control, and repeated activation is idempotent for both prompt text and project identity.

## Deterministic orchestration path

Full Mode records an orchestration activation descriptor on the project. Independent component work continues through the existing project-orchestrator authority: a local process configures a lane plan with `POST /orchestrator/configure`, then drives it with `POST /orchestrator/tick`; lane creation remains the durable `CREATE_LANE_CHAT` command with the canonical `laneId`, `branch`, `baselineSha`, and `prompt` contract.

The Full Mode extension does not bypass the existing `local-process` orchestration authorization boundary and does not create a second mutation or runner authority. Runner-on-demand, snapshots/restore, DOM compaction, history/search/export/import, recovery, and Integration Controller behavior remain owned by their existing components.
