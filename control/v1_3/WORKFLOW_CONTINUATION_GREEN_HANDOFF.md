# ChatSentinel v1.3 Workflow Continuation — Candidate Handoff

Status: `REVALIDATION_REQUIRED`
Branch: `feat/v13-workflow-continuation`
Worktree: `C:\ChatSentinel-worktrees\v13-workflow`

## Delivered generic capability

- completion of the current stage is never treated as completion of the whole project unless it is the declared terminal stage;
- a green stage automatically advances to the next stage;
- required lanes are materialized with bounded parallelism without dropping lanes beyond the immediate launch bound;
- a green integration lane supplies the exact durable baseline for the next stage;
- missing next-stage or baseline evidence fails closed through REPLAN/BLOCKED behavior;
- Verified Prompt Delivery, Full Project Mode, durable command ownership, and `baselineSha` propagation remain integrated.

## Repository separation

ChatSentinel contains no project-specific roadmap compiler or embedded external-repository workflow profile. Project roadmaps remain in the project repository that owns them; ChatSentinel consumes only the generic workflow manifest contract.

## Acceptance boundary

Earlier green evidence predates repository decoupling and is superseded for release purposes. The exact decoupled branch tip must pass the full independent unit, syntax, policy, shell, browser E2E, production smoke, dependency audit, diff, and platform parser gates before this handoff may be marked green.
