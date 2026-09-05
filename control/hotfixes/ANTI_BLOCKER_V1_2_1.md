# Anti-Blocker — v1.2.1 Prompt Delivery

Date: 2026-09-05

## Live failure evidence

- New Chat tab opened successfully but no user message was submitted.
- Browser URL contained the lane text in `?prompt-textarea=...`.
- Durable CREATE_LANE_CHAT records nevertheless showed `promptSent=true` and `status=succeeded`.
- The affected lane remained on fallback identity `tab:<id>` / generic ChatGPT title rather than progressing to a stable conversation.

## Root cause

A DOM click was treated as delivery success. If ChatGPT's React/editor state had not accepted the injected text, a generic form submit could serialize the textarea into the URL. There was no independent post-click delivery evidence gate.

## Permanent protections

- Explicit ChatGPT send-control selection; no generic submit fallback.
- Post-click background verification before durable success.
- Prompt-query contamination detector and safe-root recovery.
- False historical ownership is verified before deduplication.
- Browser fixture deliberately contains a generic GET submit trap.
- Stable runtime and future development worktrees remain physically separated.

## Rollback

`baseline/v1.2.0` remains immutable at `9ec1cd6ab074556620015c655505ec62f6a3101a` and the independent archive remains under `C:\ChatSentinel-versions\ChatSentinel-1.2.0-baseline`.
