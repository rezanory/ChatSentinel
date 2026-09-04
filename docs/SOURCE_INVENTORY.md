# Third-Party Source / Reference Inventory — ChatSentinel v1.1

ChatSentinel's recovery engine, watchdog, Git reconciliation, side-effect policy, state persistence, project registry, recovery actuators and orchestration are project-owned implementations. v1.1+ additionally uses three permissively licensed browser-extension patterns/components with attribution.

| Project | License | v1.1 use | Runtime dependency? |
|---|---|---|---:|
| `Sami21234/Chatgpt-Sidebar` | MIT | The fixed in-page, collapsible/resizable panel interaction was used as a design/code pattern. ChatSentinel reimplements it as an isolated Shadow DOM project console rather than the upstream global-CSS sidebar. | No |
| `GoogleChrome/chrome-extensions-samples` | Apache-2.0 | The official `chrome.tabs.group(...)` + `chrome.tabGroups.update(...)` grouping pattern is adapted for per-project parallel ChatGPT tab groups. | No |
| `glyndavidson/chatgpt-folders` | MIT | Reference for in-ChatGPT folder/project tree, drag/drop and grouped-conversation UX. No source vendored in v1.1. | No |
| `nathabee/chatgpt-organizer` | MIT | Reference for Projects/Settings information architecture. Its separate Chrome Side Panel surface is intentionally not used. | No |
| `xcanwin/KeepChatGPT` | GPL-2.0 | Behavioral reference for interruption/recovery only; GPL source excluded. | No |
| `11me/light-session` | MIT | The Conversation Window component adapts the turn-aware conversation-tree trimming/fetch-proxy approach so old turns are excluded before React renders them. ChatSentinel adds component isolation, conservative defaults, runtime configuration and fail-open behavior. | No |
| `dizzpy/ChatGPT-Auto-Continue` | No clear license identified | Continue/Retry UX reference only. | No |
| `boringresearch/plugin-chatgpt-automation` | No clear license identified | Prompt-queue/workflow reference only. | No |

## Notices

Full redistribution notices for the adapted permissive sources are stored in:

- `LICENSES/Sami21234-Chatgpt-Sidebar-MIT.txt`
- `LICENSES/GoogleChrome-chrome-extensions-samples-Apache-2.0.txt`
- `LICENSES/11me-light-session-MIT.txt`
- `THIRD_PARTY_NOTICES.md`

ChatSentinel still has **0 npm runtime dependencies** and **0 npm development dependencies**.
