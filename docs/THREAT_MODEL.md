# Threat Model — ChatSentinel v1.1.0

## Trusted boundary

ChatSentinel assumes the authenticated Windows user and processes already executing with that user's local privileges are trusted. It is not designed to defend against a fully compromised Windows account.

The browser extension is trusted only after its stable `chrome-extension://` origin pairs with the local watchdog. The watchdog itself is reachable only through loopback.

## Assets

- Project Git state and canonical checkpoint metadata.
- Project registry, project-to-conversation membership and per-project policy.
- Conversation/tab identity mappings used for parallel-chat supervision.
- Recovery decisions and recent session telemetry.
- Stable extension identity private key stored outside the repository.

ChatSentinel does **not** require OpenAI credentials, API keys or GitHub tokens in its repository/runtime protocol.

## Threats and controls

### Malicious web page calls the local API

Control: browser requests from ordinary `https://` origins are rejected; only the paired extension origin with `x-chatsentinel-client: extension` is accepted. CORS is not wildcard.

### Malicious/duplicate extension calls the local API

Control: stable extension ID plus TOFU origin pairing. A different extension origin is rejected. Pairing can only be reset by a local process.

### Blind Retry duplicates a project side effect

Control: Retry is allowed only when side-effect risk is explicitly `none`; Git state, operation class and previous reconciliation evidence are evaluated first. Unknown state escalates or rechecks instead of repeating work.

### Stale checkpoint causes incorrect continuation

Control: a Git checkpoint is fresh only when the working tree is clean and local HEAD exactly equals remote HEAD.

### Watchdog crashes or state file is damaged

Control: Windows supervisor restarts the process; state is persisted atomically. Corrupt state is quarantined. Durable project policy survives restart; recent session telemetry has an RPO of <=300 ms.

### Log or state growth exhausts disk/memory

Control: JSONL log rotation, 24-hour session TTL, maximum session count and bounded HTTP payload/header/connection limits.

### Test-only code expands production browser access

Control: production manifest injects only on `chatgpt.com`. E2E builds a temporary extension copy and adds local fixture permissions only to that temporary copy. `policy-check` enforces this.

### Third-party source or license boundary is lost

Control: adapted MIT/Apache-2.0 browser patterns carry notices/licenses in `THIRD_PARTY_NOTICES.md` and `LICENSES/`; reference-only projects remain non-vendored. Runtime npm dependencies remain zero.


### A chat is attached to the wrong project

Control: project membership is explicit and persisted by conversation identity. Root-route chats use a unique `tab:<id>` fallback instead of a shared `page:/` value. If a stable ChatGPT conversation ID appears later, membership migrates from the temporary tab identity and the fallback record is forgotten.

### Project A recovery policy leaks into Project B

Control: projects are independent records; signal handling resolves policy and Git path from the conversation's `projectId`. Integration tests run simultaneous projects with different policies and verify isolation across restart.

### A stale Chrome tab ID focuses the wrong/closed chat

Control: tab IDs are verified with `chrome.tabs.get`. If unavailable, only a saved `https://chatgpt.com/` URL may be reopened; the active ChatGPT page is not navigated away by the in-page console.

### The in-page panel breaks ChatGPT's own DOM/CSS

Control: ChatSentinel renders inside an isolated Shadow DOM and does not change global body margins/theme classes. On-demand script injection is limited to `chatgpt.com` by production host permissions.
## Privacy

The content script examines page text locally only to recognize known error states. It sends normalized booleans/state/timing/URL/conversation ID to the local watchdog, not the conversation body. Recovery prompts are generated locally and are not persisted in watchdog logs.

## Residual risks

ChatGPT DOM/button labels can change. The actuator therefore validates visible/enabled controls, keeps auto-recovery opt-in, and fails closed when the expected composer/button is unavailable. Browser/OS updates can still require extension compatibility maintenance.
