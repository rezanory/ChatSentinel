# Third-Party Source / Reference Inventory — ChatSentinel v1.1

ChatSentinel's recovery engine, watchdog, Git reconciliation, side-effect policy, state persistence, project registry, recovery actuators and orchestration are project-owned implementations. v1.1 additionally uses two small permissively licensed browser-extension patterns with attribution.

| Project | License | v1.1 use | Runtime dependency? |
|---|---|---|---:|
| `Sami21234/Chatgpt-Sidebar` | MIT | The fixed in-page, collapsible/resizable panel interaction was used as a design/code pattern. ChatSentinel reimplements it as an isolated Shadow DOM project console rather than the upstream global-CSS sidebar. | No |
| `GoogleChrome/chrome-extensions-samples` | Apache-2.0 | The official `chrome.tabs.group(...)` + `chrome.tabGroups.update(...)` grouping pattern is adapted for per-project parallel ChatGPT tab groups. | No |
| `glyndavidson/chatgpt-folders` | MIT | Reference for in-ChatGPT folder/project tree, drag/drop and grouped-conversation UX. No source vendored in v1.1. | No |
| `nathabee/chatgpt-organizer` | MIT | Reference for Projects/Settings information architecture. Its separate Chrome Side Panel surface is intentionally not used. | No |
| `xcanwin/KeepChatGPT` | GPL-2.0 | Behavioral reference for interruption/recovery only; GPL source excluded. | No |
| `11me/light-session` | MIT | Long-chat DOM/performance reference only. | No |
| `dizzpy/ChatGPT-Auto-Continue` | No clear license identified | Continue/Retry UX reference only. | No |
| `boringresearch/plugin-chatgpt-automation` | No clear license identified | Prompt-queue/workflow reference only. | No |

## Notices

Full redistribution notices for the two adapted permissive sources are stored in:

- `LICENSES/Sami21234-Chatgpt-Sidebar-MIT.txt`
- `LICENSES/GoogleChrome-chrome-extensions-samples-Apache-2.0.txt`
- `THIRD_PARTY_NOTICES.md`

ChatSentinel still has **0 npm runtime dependencies** and **0 npm development dependencies**.

## v1.2 C4 audit/folder UX provenance

The C4 lane keeps the new audit/history and nested folder components clean-room and attribution-safe:

| Project | License status | C4 use | Source copied? |
|---|---|---|---:|
| `hiuxia/chatgpt-conversation-archive` | No clear license identified during Issue #3 triage | Behavior-only reference for nested local folders and portable archive organization. `src/project-tree.js` is an independent implementation. | No |
| `benedyktdryl/gpt-organizer` | No clear license identified during Issue #3 triage | Behavior-only reference for persistent audit-log / preview-oriented organization concepts. `src/audit-history.js` is an independent implementation. | No |

No additional third-party runtime dependency or vendored source is introduced by C4.
