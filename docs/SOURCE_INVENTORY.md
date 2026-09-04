# Third-Party Source / Reference Inventory

ChatSentinel v1.0.0 production core is a clean-room original implementation. **No source code from the GitHub projects below is copied, vendored, imported or required at runtime.**

| GitHub project | Why it was reviewed | License/status observed | Source code copied into ChatSentinel? | Actual use |
|---|---|---|---|---|
| `xcanwin/KeepChatGPT` | ChatGPT interruption, keep-alive, refresh/recovery behavior | GPL-2.0 | **No** | Behavioral reference only; GPL source deliberately excluded from the core. |
| `11me/light-session` | Long-conversation DOM/performance mitigation ideas | MIT | **No** | Architectural/performance reference only in v1.0. |
| `dizzpy/ChatGPT-Auto-Continue` | Continue/Retry interaction pattern | No clear license identified during review | **No** | UX behavior reference only. |
| `boringresearch/plugin-chatgpt-automation` | Prompt queue and browser-automation pattern | No clear license identified during review | **No** | Workflow behavior reference only. |

## What was implemented independently

ChatSentinel's recovery state machine, DOM signal detector, Git reconciler, side-effect classifier, safe Retry policy, Continue/New-Chat actuators, local HTTP watchdog, persistent state store, Windows supervisor, extension popup, security controls and test harness are project-owned implementations written specifically for ChatSentinel.

## License boundary

Public GitHub availability is not permission to copy. Source reuse requires a deliberate dependency decision, compatible license and attribution. v1.0 avoids that dependency entirely: reviewed projects remain documentary references, not code inputs.

`npm` runtime dependencies: **0**. `npm` development dependencies: **0**.
