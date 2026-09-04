# Third-Party Notices

ChatSentinel includes or adapts small portions of permissively licensed open-source code. The project-specific recovery engine, watchdog, project registry, safety gates, persistence, and orchestration remain ChatSentinel-owned implementations.

## Sami21234/Chatgpt-Sidebar — MIT

Repository: `https://github.com/Sami21234/Chatgpt-Sidebar`

Used in ChatSentinel v1.1 as a design/code reference for an in-page fixed, collapsible and resizable sidebar injected by a Chrome content script. ChatSentinel adapts the panel interaction pattern into a Shadow DOM component rather than copying the original global-CSS implementation.

Copyright (c) 2025 Sami

Licensed under the MIT License. The original LICENSE is available in the upstream repository.

## GoogleChrome/chrome-extensions-samples — Apache-2.0

Repository: `https://github.com/GoogleChrome/chrome-extensions-samples`

The minimal project-tab grouping pattern uses the official sample approach:
`chrome.tabs.group(...)` followed by `chrome.tabGroups.update(...)`.

Licensed under the Apache License, Version 2.0. Modified for ChatSentinel project groups.


## 11me/light-session ? MIT

Repository: `https://github.com/11me/light-session`

ChatSentinel's Conversation Window component adapts the upstream idea and turn-aware conversation-tree trimming approach so old turns are removed before React renders them. ChatSentinel keeps this as an isolated component, uses a conservative default window, preserves the tree anchor and retained hidden/tool nodes, and fails open to the original response on any parsing/interception error.

Copyright (c) 2025 LightSession Contributors

Licensed under the MIT License. The complete upstream license is stored in `LICENSES/11me-light-session-MIT.txt`.

## Reference-only projects (no source copied)

- `glyndavidson/chatgpt-folders` — MIT. Referenced for in-ChatGPT folder/tree UX, nested folder behavior and drag/drop organization. No source is currently vendored into ChatSentinel v1.1.
- `nathabee/chatgpt-organizer` — MIT. Referenced for Projects/Settings information architecture. Its Chrome `sidePanel` surface is intentionally not used because ChatSentinel renders controls inside the active ChatGPT page.

The earlier reference-only projects (`xcanwin/KeepChatGPT`, `dizzpy/ChatGPT-Auto-Continue`, and `boringresearch/plugin-chatgpt-automation`) remain documented in `docs/SOURCE_INVENTORY.md`. `11me/light-session` moved from reference-only in v1.0 to an attributed MIT adaptation for the Conversation Window component.

## v1.2 reuse-completion sources approved for direct adaptation

The following permissively licensed sources were audited and pinned for selective adaptation. Their license texts are stored under `LICENSES/`. This research-lane notice records approved provenance; implementation lanes must identify any actual adapted paths in their handoff.

### dyemane/tab-groups — MIT

Repository: `https://github.com/dyemane/tab-groups`
Pinned revision: `4e73f6328b4b4201edf0011d63bee578d7884b60`
Approved use: project tab-group capture/restore/switch, guarded auto-save, search/diff and versioned import/export patterns.
License copy: `LICENSES/dyemane-tab-groups-MIT.txt`.

### BF-GO/session-backups — MIT

Repository: `https://github.com/BF-GO/session-backups`
Pinned revision: `5980a58102c95b56bdd31e8bbfee580f293a73e3`
Approved use: automatic/change snapshot, selective restore planning, retention, strict import validation and safe migration patterns.
License copy: `LICENSES/BF-GO-session-backups-MIT.txt`.

### yurtools/gpt-conv-manager-chrome — MIT

Repository: `https://github.com/yurtools/gpt-conv-manager-chrome`
Pinned revision: `8b7e7c55f4e72f186e90eab6fd288e0ee7e6da51`
Approved use: project/conversation discovery, local filter/sort, sequential bulk-operation delay/stop/status patterns where they fit ChatSentinel component contracts.
License copy: `LICENSES/yurtools-gpt-conv-manager-chrome-MIT.txt`.
