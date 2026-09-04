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

## Reference-only projects (no source copied)

- `glyndavidson/chatgpt-folders` — MIT. Referenced for in-ChatGPT folder/tree UX, nested folder behavior and drag/drop organization. No source is currently vendored into ChatSentinel v1.1.
- `nathabee/chatgpt-organizer` — MIT. Referenced for Projects/Settings information architecture. Its Chrome `sidePanel` surface is intentionally not used because ChatSentinel renders controls inside the active ChatGPT page.

The earlier reference-only projects (`xcanwin/KeepChatGPT`, `11me/light-session`, `dizzpy/ChatGPT-Auto-Continue`, and `boringresearch/plugin-chatgpt-automation`) remain documented in `docs/SOURCE_INVENTORY.md`.
