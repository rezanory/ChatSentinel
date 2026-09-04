# ChatSentinel

ChatSentinel is a local-first watchdog and recovery controller for long-running ChatGPT project work.

Its job is to detect stalled or interrupted conversations, reconcile external project state, and choose the safest recovery action without blindly retrying side effects.

## Core recovery actions

- `WAIT`
- `SAFE_RETRY`
- `CONTINUE_SAME_CHAT`
- `RELOAD_AND_RECHECK`
- `CONTINUE_NEW_CHAT`
- `ESCALATE`

## Design rule

A visible Retry button is never sufficient evidence for retry. ChatSentinel must first classify side-effect risk and reconcile the latest known project checkpoint.

## Components

- Browser Sentinel: observes ChatGPT page state and emits normalized signals.
- Recovery Engine: converts signals + project evidence into a recovery decision.
- Project Reconciler: verifies GitHub/source-of-truth state before retry/continue.
- Local Watchdog: owns heartbeats, process health and recovery execution.
- Integrations: Watchgoose, Remote Desktop Commander, Make, aictrl.dev and GitHub.

## License/source policy

The core is original code. GPL projects such as KeepChatGPT are treated as behavioral references only unless an explicitly GPL-compatible distribution decision is made later. Permissive sources may be reused only with attribution and license compliance.
