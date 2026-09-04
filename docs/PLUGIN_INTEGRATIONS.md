# Plugin / MCP Integration Inventory

ChatSentinel is intentionally functional without ChatGPT plugins. No plugin source code is copied into this repository. Plugins/MCPs are external operational capabilities.

## Actually used while building / operating ChatSentinel

| Plugin / capability | Used? | Role | Runtime dependency? |
|---|---:|---|---:|
| **GitHub** | Yes | Repository reconciliation, commits, issues, release/source-of-truth verification. | No — ChatSentinel uses local `git`; the ChatGPT GitHub connector is an operations tool. |
| **Remote Desktop Commander** | Yes | Created/edited local files, ran tests, inspected/killed/restarted processes and validated Windows installation. | No — external repair/operations surface. |
| **Watchgoose** | Yes, partially | A `chatsentinel` dead-man check was created and inspected. | No — optional external heartbeat; currently unarmed until its private Ping URL is supplied. |
| **TinyFish** | Yes | Public documentation/source research, including Watchgoose API behavior. | No. |
| **Plugin Management** | Yes | Plugin-directory discovery/verification. | No. |
| **ToolCheck by M8ven** | Yes | Searched for trusted browser-automation MCP alternatives; none became a runtime dependency. | No. |


## Native/browser capabilities reused in v1.1

- **Chrome `tabs` / `tabGroups` APIs** — critical for grouping and focusing parallel chats of the same project; implemented directly with the native API, not an MCP dependency.
- **Chrome `scripting` API** — injects the in-page console on toolbar click when an existing ChatGPT tab predates an unpacked-extension reload.
- **Shadow DOM** — isolates ChatSentinel's in-page project console from ChatGPT global styles/DOM.
## Reviewed/available but not wired into v1.1 runtime

- **Make** — optional future escalation/notification workflow.
- **aictrl.dev** — optional engineering-workflow evidence source.
- **Brainbase MCP** — optional multi-agent orchestration.
- **WebMCP** — optional future task-completing surface integration.
- **AgentGrid.io / ProductOS** — inspected as available platform capabilities, not used by ChatSentinel runtime.

## Critical-path rule

A frozen ChatGPT conversation cannot supervise itself. The watchdog therefore lives outside the affected conversation: local Windows process + Chrome extension + local Git/source-of-truth. Plugins can extend observability or recovery but cannot be the sole critical dependency.
