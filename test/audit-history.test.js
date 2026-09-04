import test from 'node:test';
import assert from 'node:assert/strict';
import { appendAuditEvent, listAuditEvents } from '../src/audit-history.js';

test('audit history appends bounded attribution-safe action and recovery events', () => {
  const meta = {};
  const store = { meta, setMeta(key, value) { meta[key] = value; } };
  appendAuditEvent(store, { type: 'action', action: 'PROJECT_CREATED', outcome: 'success', projectId: 'p1', projectName: 'Alpha' }, new Date('2026-01-01T00:00:00Z'));
  appendAuditEvent(store, { type: 'recovery', action: 'SAFE_RETRY', outcome: 'decided', projectId: 'p1', conversationId: 'c1', reason: 'retry visible' }, new Date('2026-01-01T00:00:01Z'));
  appendAuditEvent(store, { type: 'action', action: 'PROJECT_CREATED', outcome: 'success', projectId: 'p2' }, new Date('2026-01-01T00:00:02Z'));

  const all = listAuditEvents(store);
  assert.equal(all.length, 3);
  assert.equal(all[0].projectId, 'p2');
  const p1 = listAuditEvents(store, { projectId: 'p1', limit: 10 });
  assert.deepEqual(p1.map(row => row.action), ['SAFE_RETRY', 'PROJECT_CREATED']);
  assert.equal(p1[0].reason, 'retry visible');
});
