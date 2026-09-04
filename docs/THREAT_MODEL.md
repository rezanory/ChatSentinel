# Threat Model — ChatSentinel v1.0.0

## Trusted boundary

ChatSentinel assumes the authenticated Windows user and processes already executing with that user's local privileges are trusted. It is not designed to defend against a fully compromised Windows account.

The browser extension is trusted only after its stable `chrome-extension://` origin pairs with the local watchdog. The watchdog itself is reachable only through loopback.

## Assets

- Project Git state and canonical checkpoint metadata.
- Conversation-to-project/policy mappings.
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

### Third-party source contaminates the core/license boundary

Control: production-code policy check rejects names of the reviewed external ChatGPT automation repositories inside `src/` and `extension/`. The production core is clean-room original code; third-party behavior references remain documentation only.

## Privacy

The content script examines page text locally only to recognize known error states. It sends normalized booleans/state/timing/URL/conversation ID to the local watchdog, not the conversation body. Recovery prompts are generated locally and are not persisted in watchdog logs.

## Residual risks

ChatGPT DOM/button labels can change. The actuator therefore validates visible/enabled controls, keeps auto-recovery opt-in, and fails closed when the expected composer/button is unavailable. Browser/OS updates can still require extension compatibility maintenance.
