import test from 'node:test';
import assert from 'node:assert/strict';

await import('../extension/components/chat-control/membership-repair.js');
const { repairStaleFocus } = globalThis.ChatSentinelChatMembershipRepair;

test('stale focus reattaches the stable conversation to the replacement tab', async () => {
  const calls = [];
  const project = {
    projectId: 'project:test', groupTabs: true,
    chats: [{
      conversationId: 'WEB:stable', tabId: 7, title: 'Lane INT',
      url: 'https://chatgpt.com/c/WEB:stable', laneId: 'INT', laneName: 'Integration',
      branch: 'integration/reuse-completion-v1', role: 'integration'
    }]
  };
  const adapter = {
    getProject: async () => project,
    getTab: async () => ({ id: 12, title: 'ChatGPT', url: 'https://chatgpt.com/c/WEB:stable' }),
    attach: async payload => { calls.push(['attach', payload]); return { ok: true }; },
    groupProjectTabs: async value => { calls.push(['group', value.projectId]); return { ok: true }; }
  };
  const result = await repairStaleFocus({
    command: { payload: { projectId: 'project:test', conversationId: 'WEB:stable', tabId: 7 } },
    result: { ok: true, tabId: 12, reused: false, staleRecovered: true }
  }, adapter);

  assert.equal(result.membershipRepaired, true);
  assert.equal(result.regrouped, true);
  assert.equal(calls[0][0], 'attach');
  assert.equal(calls[0][1].conversationId, 'WEB:stable');
  assert.equal(calls[0][1].tabId, 12);
  assert.equal(calls[0][1].laneId, 'INT');
  assert.equal(calls[0][1].branch, 'integration/reuse-completion-v1');
  assert.deepEqual(calls[1], ['group', 'project:test']);
});

test('non-stale focus leaves membership untouched', async () => {
  let touched = false;
  const result = await repairStaleFocus({
    command: { payload: { projectId: 'project:test', conversationId: 'WEB:stable' } },
    result: { ok: true, tabId: 7, reused: true, staleRecovered: false }
  }, {
    getProject: async () => { touched = true; return null; },
    attach: async () => { touched = true; return { ok: true }; }
  });
  assert.equal(touched, false);
  assert.equal(result.staleRecovered, false);
});
