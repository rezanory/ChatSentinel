import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { appendAuditEvent, isRoutineRecoveryEvent, listAuditEvents } from '../src/audit-history.js';

test('routine healthy WAIT decisions never fill durable action history and old noise is pruned', () => {
  const meta = { auditHistory: [
    { type: 'recovery', action: 'WAIT', reason: 'no-recovery-needed', conversationId: 'c1' },
    { type: 'action', action: 'PROJECT_CREATED', outcome: 'success', projectId: 'p1' },
    { type: 'recovery', action: 'WAIT', reason: 'no-recovery-needed', conversationId: 'c2' }
  ] };
  const store = { meta, setMeta(key, value) { meta[key] = value; } };
  const routine = { type: 'recovery', action: 'WAIT', outcome: 'decided', conversationId: 'c1', reason: 'no-recovery-needed' };
  assert.equal(isRoutineRecoveryEvent(routine), true);
  assert.equal(appendAuditEvent(store, routine, new Date('2026-09-06T00:00:00Z')), null);
  assert.deepEqual(listAuditEvents(store).map(row => row.action), ['PROJECT_CREATED']);
  assert.equal(meta.auditHistory.length, 1);
  appendAuditEvent(store, { type: 'recovery', action: 'SAFE_RETRY', outcome: 'decided', conversationId: 'c1', reason: 'native retry visible' }, new Date('2026-09-06T00:00:01Z'));
  assert.deepEqual(listAuditEvents(store).map(row => row.action), ['SAFE_RETRY', 'PROJECT_CREATED']);
});

test('project console owns a recovery button slot while preserving the Remote Desktop Commander recovery card', () => {
  const source = fs.readFileSync(new URL('../extension/project-console.js', import.meta.url), 'utf8');
  assert.match(source, /RECOVERY_BUTTON_ID = 'chatsentinel-runtime-recovery'/);
  assert.match(source, /id="chatsentinel-runtime-recovery"/);
  assert.match(source, /id="rdcRecoveryCard"/);
  assert.match(source, /renderRemoteDesktopCommanderRecovery/);
  assert.match(source, /function isRoutineHistoryEvent/);
});

test('offline recovery rebinds an existing stale DOM button in each fresh extension context', () => {
  const source = fs.readFileSync(new URL('../extension/components/offline-recovery/controller.js', import.meta.url), 'utf8');
  assert.match(source, /let boundButton = null;/);
  assert.match(source, /if \(boundButton !== button\)/);
  assert.match(source, /boundButton = button;/);
});

test('background self-rehydrates already-open ChatGPT tabs after extension service-worker restart', () => {
  const source = fs.readFileSync(new URL('../extension/background.js', import.meta.url), 'utf8');
  assert.match(source, /rehydrateOpenChatGptTabs\('service-worker-start'\)/);
  assert.match(source, /CHATSENTINEL_GET_IDENTITY/);
  assert.match(source, /files: CONTENT_SCRIPT_FILES/);
  assert.match(source, /https:\/\/chatgpt\.com\/\*/);
});
