# Runtime Context Guard

Standalone content-runtime lifecycle guard for unpacked-extension reloads.

## Contract

- exposes `ChatSentinelRuntimeContext` in the extension isolated world;
- treats a missing `chrome.runtime` or missing runtime id as an invalidated context;
- wraps `sendMessage` so synchronous and asynchronous invalidation failures never escape;
- provides guarded runtime message-listener registration/removal;
- owns no watchdog, queue, Git, browser recovery or orchestration authority.

## Integration

The guard loads before all document-idle ChatSentinel content components.
`content.js` disconnects its mutation observer and heartbeat after invalidation.
`project-console.js` uses guarded runtime messaging instead of a direct runtime call.
Dynamic content injection also loads this guard first.

This prevents the reload-time errors `Extension context invalidated` and
`Cannot read properties of undefined (reading 'sendMessage')` from recurring
once the guarded content scripts are active.
