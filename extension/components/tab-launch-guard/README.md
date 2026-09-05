# Tab Launch Guard

Standalone browser/tab safety component for ChatSentinel.

Responsibilities:
- pace new tab creation globally to reduce ChatGPT/renderer request bursts;
- strip prompts and untrusted query state from launch URLs;
- detect rate-limit pages and browser crash/unresponsive states before prompt delivery;
- keep prompts in durable command/state paths, never in the URL;
- enforce one live tab owner for one logical `(project, lane/conversation, prompt)` delivery;
- allow explicit ownership transfer only during a deliberate replacement;
- recover crashed project tabs with bounded escalation: reload + continue, replace + restore + continue, then halt;
- keep crash-state transitions within one incident window so changing error pages do not reset the retry budget.

The component reuses existing Chrome tabs/storage APIs, Durable Command Queue, project registry, content-script actuator and Chat Control/recovery substrates. It adds no runtime dependency.
