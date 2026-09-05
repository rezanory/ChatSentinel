# Message Delivery Recovery component

Responsibility: recover only the ChatGPT outgoing-message failure state that displays `Message delivery timed out. Please try again.` with its native Retry control.

## Contract

- Detect the active delivery-timeout marker, not a generic Retry button.
- Bind retry to the native Retry control associated with that timeout region.
- Treat the timeout as inactive when a later user/assistant turn follows it.
- Generate a stable per-incident key from message/user identity when available.
- Deduplicate repeated actuation during a cooldown.
- Allow at most two native Retry attempts per incident.
- After the retry budget is exhausted, recovery escalates instead of looping.

## Boundary

This component does not resend prompt text, reconstruct user messages, reload the tab, replace a chat, execute Git operations, or own the durable command queue. It composes the existing content detector, recovery policy, actuator, session storage and browser execution substrates.

It is intentionally separate from Response Completion Recovery: outgoing message delivery timeout means the user message was not delivered; `Connection interrupted. Waiting for the complete answer` means an assistant response was interrupted after delivery.
