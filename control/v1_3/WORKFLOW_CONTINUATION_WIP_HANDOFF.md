# ChatSentinel v1.3 Workflow Continuation — Handoff

Status: `REVALIDATION_REQUIRED_AFTER_REPOSITORY_DECOUPLING`
Branch: `feat/v13-workflow-continuation`
Worktree: `C:\ChatSentinel-worktrees\v13-workflow`

## Product boundary

Workflow Continuation is a generic ChatSentinel capability. It must not embed or compile roadmap data from another repository.

Each attached project owns its own machine-readable workflow manifest, normally `control/chatsentinel-workflow.json`. ChatSentinel reloads that manifest, persists continuation state, advances stages, chains exact green integration baselines, and refuses false completion before the declared terminal stage.

## Implemented behavior

- stage completion is distinct from project completion;
- terminal completion is explicit;
- ADVANCE materializes bounded parallel lanes;
- unqueued required lanes remain active for later ticks;
- REPLAN/BLOCKED prevents silent stopping when the terminal contract is not yet satisfied;
- exact integration heads are persisted as next-stage baselines;
- `baselineSha` survives command validation and project membership metadata.

Final acceptance must be rerun on the repository-decoupled exact SHA before release promotion.
