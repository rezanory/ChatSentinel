# Plugin / External Control Integration

ChatSentinel stays functional without ChatGPT plugins. Plugins extend observability and recovery from outside the affected conversation.

## Runtime / operations roles

- **GitHub** — canonical project state, SHA/branch verification and durable handoffs.
- **Remote Desktop Commander** — external host/process inspection and repair when the browser or local watchdog is unhealthy.
- **Watchgoose** — dead-man heartbeat for the ChatSentinel watchdog. The local service accepts `CHATSENTINEL_HEARTBEAT_URL`; the Watchgoose check must be armed with its private Ping URL.
- **Make** — optional cloud escalation/notification workflows; not on the critical recovery path.
- **aictrl.dev** — optional engineering-workflow status evidence when a project uses its governed workflows.
- **Brainbase MCP** — optional agent orchestration; never authoritative over GitHub/source-of-truth.
- **WebMCP** — future task-completing surface integration where a website exposes a compatible surface.

## Failure-domain rule

The watchdog must not depend on the same ChatGPT conversation it is supervising. A frozen conversation cannot be the component responsible for declaring itself healthy.

## Plugin-first rule

Before adding a new integration, check native ChatGPT capabilities, installed plugins, existing MCPs and existing repository substrate. New code is justified only for the capability gap that remains.
