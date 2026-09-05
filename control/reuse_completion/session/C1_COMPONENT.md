# C1 Component Contract — Session / Tab Restore

Status: standalone reuse-completion component for Issue #3.
Branch owner: `feat/session-restore-v1`.

## Responsibility

C1 owns durable browser-side project session snapshots and restoration only:

- persist project tab-group snapshots;
- restore them after Chrome/profile startup;
- restore a selected subset of snapshot entries;
- enforce snapshot retention;
- switch to a project by restoring/focusing its latest snapshot.

C1 does not own durable command queues, search/export/import, audit/history UI, or project-folder UX.

## Components

### `SessionSnapshotStore`

Path: `extension/session-snapshot-store.js`.

Public contract:

- `saveProjectSnapshot(input)`
- `list(projectId?)`
- `latest(projectId)`
- `latestPerProject()`
- `get(snapshotId)`
- `remove(snapshotId)`
- `clearProject(projectId)`
- `prune()`

Persistence boundary:

- existing `chrome.storage.local` browser substrate;
- key `sessionSnapshots:v1`;
- schema version 1;
- default retention: 12 snapshots per project and 30 days;
- identical content is de-duplicated so heartbeat/project refreshes do not consume retention slots;
- writes are serialized to avoid lost updates;
- unsafe persisted URLs are discarded during normalization.

Restorable URL policy is deliberately narrow: HTTPS ChatGPT URLs plus loopback HTTP used by the repository E2E fixture.

### `SessionRestoreController`

Path: `extension/session-restore-controller.js`.

Adapters are injected rather than hidden inside the component:

- Chrome `tabs`, `tabGroups`, `windows`, and `storage.local`;
- the existing watchdog `apiRequest` project registry;
- `SessionSnapshotStore`.

Public contract:

- `captureAllProjects(reason)`
- `captureProjectById(projectId, reason)`
- `captureProject(project, reason)`
- `scheduleCaptureAll(reason)`
- `listSnapshots(projectId?)`
- `restoreSnapshot(snapshotId, options)`
- `restoreLatest(projectId, options)`
- `restoreAfterBrowserRestart(options)`
- `switchProject(projectId)`

Selective restore accepts snapshot `entryIds` and/or durable `conversationIds`.

## Browser restart behavior

`background.js` composes C1 through `importScripts` and registers `chrome.runtime.onStartup`.

Restore behavior is idempotency-aware:

1. wait briefly for Chrome native startup restoration to settle;
2. load only the latest retained snapshot per project;
3. reuse already-restored tabs using per-URL pools rather than creating duplicates;
4. create only missing tabs;
5. rebuild project tab groups and metadata;
6. reattach durable project membership when the watchdog is reachable;
7. treat membership reattach failure as a warning so browser restoration itself is not blocked.

For root/fallback `tab:<id>` identities, pending project membership is stored against the new tab id so normal stable-identity migration can complete later.

When Chrome reports a tab removal as part of window shutdown, the old fallback project mapping is not deliberately forgotten. This preserves a restartable snapshot/membership boundary across browser shutdown.

## Project switching

`switchProject(projectId)` restores or reuses the latest snapshot and focuses its first available project tab/window. It does not close unrelated project tabs and does not assume queue or audit authority.

## Background message surface

The composed background exposes:

- `CHATSENTINEL_LIST_SESSION_SNAPSHOTS`
- `CHATSENTINEL_CAPTURE_SESSION_SNAPSHOT`
- `CHATSENTINEL_RESTORE_SESSION_SNAPSHOT`
- `CHATSENTINEL_SWITCH_PROJECT`

No new UI surface is introduced in C1.

## Failure policy

Restore operations do not fail-fast across entries/groups:

- tab-create failures are collected and later entries still run;
- tab-group failures are collected and later groups still run;
- project reattach failures are reported separately as `attachFailures`;
- snapshot write failure never replaces the last persisted snapshot;
- corrupt persisted rows are normalized away instead of preventing future recovery snapshots.

## Reuse / provenance

C1 reuses native Chrome tab/tab-group/storage APIs and the existing ChatSentinel project/watchdog substrate. Issue #3 OSS projects informed required behavior, but this lane did not copy or directly adapt third-party source code; therefore no new third-party license payload is required for C1.

## Owned tests

- `test/session-snapshot-store.test.js`
- `test/session-restore-controller.test.js`

Focused coverage includes retention, de-duplication, corrupt state, storage write failure, selective restore, native-startup tab reuse, project switching, tab-create failure, group-update failure, and watchdog reattach failure.