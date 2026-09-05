import test from 'node:test';
import assert from 'node:assert/strict';

await import('../extension/components/project-chat-lifecycle/controller.js');
const lifecycle = globalThis.ChatSentinelProjectChatLifecycle;
const NOW = Date.parse('2026-09-05T08:45:00Z');

function chat(overrides = {}) {
  return {
    conversationId: 'conv:1', tabId: 11, state: 'IDLE',
    updatedAt: '2026-09-05T08:44:00Z',
    ...overrides
  };
}

test('active projection requires a live browser tab, fresh signal and non-terminal state', () => {
  const projects = [{ projectId: 'p1', chats: [
    chat({ conversationId: 'active', tabId: 11, updatedAt: '2026-09-05T08:30:00Z' }),
    chat({ conversationId: 'closed', tabId: 12 }),
    chat({ conversationId: 'complete', tabId: 13, state: 'COMPLETE' }),
    chat({ conversationId: 'stale', tabId: 14, updatedAt: '2026-09-05T08:35:00Z' })
  ] }];
  const [project] = lifecycle.projectActiveChats(projects, {
    liveTabIds: [11, 13, 14], activeTabIds: [11, 13], nowMs: NOW, freshMs: 180000
  });
  assert.deepEqual(project.chats.map(row => row.conversationId), ['active']);
  assert.equal(project.chatCount, 1);
  assert.equal(project.registeredChatCount, 4);
  assert.equal(project.inactiveChatCount, 3);
});
test('newly attached live chat without a session timestamp remains visible', () => {
  const [project] = lifecycle.projectActiveChats([
    { projectId: 'p1', chats: [chat({ updatedAt: undefined, tabId: 21 })] }
  ], { liveTabIds: [21], nowMs: NOW });
  assert.equal(project.chatCount, 1);
});


test('fresh running session remains visible when DOM activity probing is temporarily unavailable', () => {
  const [project] = lifecycle.projectActiveChats([
    { projectId: 'p1', chats: [chat({ state: 'RUNNING', tabId: 22 })] }
  ], { liveTabIds: [22], activeTabIds: [], nowMs: NOW });
  assert.equal(project.chatCount, 1);
});


test('recently attached idle chat stays visible during the attachment grace window', () => {
  const [project] = lifecycle.projectActiveChats([
    { projectId: 'p1', chats: [chat({ tabId: 23, state: 'IDLE', updatedAt: '2026-09-05T08:30:00Z', attachedAt: '2026-09-05T08:44:30Z' })] }
  ], { liveTabIds: [23], activeTabIds: [], nowMs: NOW, freshMs: 180000 });
  assert.equal(project.chatCount, 1);
});

test('closed tab cleanup selects stable and fallback memberships sharing the tab id', () => {
  const rows = lifecycle.membershipsForClosedTab([
    { projectId: 'p1', chats: [
      chat({ conversationId: 'WEB:stable', tabId: 31 }),
      chat({ conversationId: 'tab:31', tabId: 31 })
    ] },
    { projectId: 'p2', chats: [chat({ conversationId: 'other', tabId: 41 })] }
  ], 31);
  assert.deepEqual(rows.map(row => row.conversationId), ['WEB:stable', 'tab:31']);
  assert.ok(rows.every(row => row.tabId === 31));
});
