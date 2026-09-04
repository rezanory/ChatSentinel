# COMPONENT_FIRST_DEVELOPMENT_RULE

Status: mandatory for all ChatSentinel development after v1.1.1.

Every new capability MUST be implemented as an independently understandable component. A feature is not complete merely because behavior exists inside a shared file.

## Required component contract

Each component owns:
- one explicit responsibility and public contract;
- its state/persistence boundary, if any;
- adapters to browser/watchdog/Git instead of hidden cross-component access;
- focused tests and failure-injection cases;
- owned paths so parallel lanes do not edit the same surfaces unnecessarily;
- version/provenance notes when OSS behavior/code is adapted.

Shared orchestrators may compose components, but MUST NOT absorb their internal logic.
