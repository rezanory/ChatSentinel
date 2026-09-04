# Source / Reference Inventory

ChatSentinel core is original implementation. External projects are used only according to their licenses and the policy below.

| Project | Role | License / status | ChatSentinel use |
|---|---|---|---|
| xcanwin/KeepChatGPT | interruption, keep-alive and recovery behavior reference | GPL-2.0 | behavioral reference only; no GPL source copied into the core |
| 11me/light-session | long-chat DOM/performance ideas | MIT | permissive reference; no source copied in v0.3 |
| dizzpy/ChatGPT-Auto-Continue | Continue/Retry UX reference | no clear license identified during baseline review | behavior reference only |
| boringresearch/plugin-chatgpt-automation | prompt queue / browser automation reference | no clear license identified during baseline review | behavior reference only |

## Rule

No third-party code is vendored merely because it is public on GitHub. Reuse requires an explicit compatible license, attribution where required, and a deliberate dependency decision.

## Why clean-room for recovery logic

A watchdog handling project side effects needs stronger guarantees than an auto-clicker. ChatSentinel therefore implements its own state model, Git reconciliation, side-effect classifier, recovery policy and actuator gates instead of copying retry logic from browser scripts.
