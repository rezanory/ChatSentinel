# ChatSentinel Nextgen Bootstrap

Status: PH00_BOOTSTRAP_STARTED / ARTIFACT_VENDORED_COPY_PENDING
Date: 2026-09-06
Normative workflow: Canonical Software Engineering Workflow v3.0.1
Normative SHA-256: cf74c19b44f7b0230dba9ee6b045de2a1a953168ae142b7b8af51312ad9d4b07
Working source baseline: 874112cff9d77837f93cdd616abe620d1aa2e4dd
Working source tree: 05acb3a515206b5ed24e0be48b406b830b715a31
Immutable fallback: backup/v1.3.4-working-20260906
Nextgen integration branch: feat/nextgen-ep2-l5-v1

Final project artifacts for this bootstrap:
- ChatSentinel_FINAL_Development_Workflow_v1.1.md sha256=65e3841457035810c980568d195912f87c6bbf0b8378ad77153a1652a2a24803
- ChatSentinel_FINAL_Target_Architecture_and_Execution_Master_v1.1.md sha256=8e0bdf7fa121b00fb53f0acf8ea9c52ba3d679a590dfe31e179b320ce715141d
- ChatSentinel_Project_Profile_v1.1.yaml sha256=c0deb91efeaaf8c51870cc60fa00035aad7db61bec0a0fd2e93d10376cbf3440
- ChatSentinel_Initial_Component_Registry_v1.1.json sha256=dda74665e78a5f750befb2bc482842c3673f66f8e137c40b9c9fd2cb8dac7c47
- ChatSentinel_Initial_DAG_v1.1.json sha256=1b6890fa061dd6498ba07e27576be5902c0355b036b4d585e5618693665a8667
- ChatSentinel_Source_Data_Registry_v1.1.json sha256=b3a04afde21ef253d32e306e376d240b343b5607826af462bfd0f072fb46237c
- ChatSentinel_Known_Bad_Corpus_Seed_v1.1.json sha256=5d3ef780001c519a27f174a244f91f58f189beafb607ab5390130f64ada576a1
- Distribution manifest sha256=88a54f1650b0c85e2fa2318c0aeb38e944636ecff935a97252d0eeb61b3f8c15

Initial machine plan: 169 components, 375 required DAG edges, acyclic verified.

Mandatory field-observed regression:
BUG-ORCH-DIRECT-WAVE-001 — WAVEADV/control continuation must remain a first-class supervised lane across ticks. Command success is not semantic wave completion; action-generation-scoped idempotency and multi-tick/restart regression evidence are mandatory before ProjectAutopilot acceptance.

Mandatory liveness/recovery additions:
- HOT liveness heartbeat and event-driven progress heartbeat are separate.
- durable single-writer Lane Lease + fencing epoch.
- registered process/tool heartbeat independent from tab heartbeat.
- semantic Page/Session Health Probe; raw page source is auxiliary.
- optional privacy-gated visual probe on SUSPECT/INSPECTING.
- takeover requires reconciliation; heartbeat loss alone is insufficient.
- dirty/untracked work is never auto-reset/deleted.
- stale owner epochs are read-only/non-canonical after takeover.

Current v1.3.4 release validation evidence on Windows/Node 22.16.0: 233 tests passed, syntax/policy/shell/E2E/production-smoke green, npm audit 0 vulnerabilities.

Do not mark PH00 terminally closed until the exact full project artifacts above are vendored or otherwise made repository-portable and re-hashed. Do not author a source component without exact Admission.