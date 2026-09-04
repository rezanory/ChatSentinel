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

## v1.2 reuse-completion audit additions

Pinned, permissive sources approved for selective direct adaptation:

- `dyemane/tab-groups` @ `4e73f6328b4b4201edf0011d63bee578d7884b60` — MIT. Approved for C1/C3 capture/restore/switch, guarded auto-save, search/diff, versioned import/export patterns.
- `BF-GO/session-backups` @ `5980a58102c95b56bdd31e8bbfee580f293a73e3` — MIT. Approved for C1/C3 snapshot dedupe/retention, selective restore planning, strict import validation and migration safety patterns.
- `yurtools/gpt-conv-manager-chrome` @ `8b7e7c55f4e72f186e90eab6fd288e0ee7e6da51` — MIT. Approved selectively for C3 discovery/filter/sort and rate-limit-aware sequential bulk-operation UX/state patterns.

Reference / clean-room only in v1.2 audit:

- `kayuling/chat-organizer-extension` — no clear repository license confirmed; persisted queue/rerender-resume behavior only.
- `hiuxia/chatgpt-conversation-archive` — no clear repository license confirmed; nested-folder/export behavior only.
- `benedyktdryl/gpt-organizer` — no clear repository license confirmed; import-plan preview and audit-log behavior only.
- `xcanwin/KeepChatGPT` — GPL-2.0; behavior/state-machine ideas only.
- `dizzpy/ChatGPT-Auto-Continue` — README declares MIT, but no standalone LICENSE was confirmed by this audit; reference only because the behavior is trivial to reimplement independently.

The audit does not add any runtime dependency. See `control/reuse_completion/research/REUSE_AUDIT_V1.md` and `PROVENANCE_MANIFEST_V1.json`.
