import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(
  new URL('../extension/components/full-project-mode/controller.js', import.meta.url),
  'utf8'
);

function loadController() {
  const sandbox = { console };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox);
  return sandbox.ChatSentinelFullProjectMode;
}

test('browser controller activates, hydrates, groups, snapshots and prepends without sending', async () => {
  const controller = loadController();
  const calls = [];
  const grouped = [];
  const snapshots = [];
  const prepended = [];
  const hydrated = {
    projectId: 'project:full', name: 'Full', projectPath: 'C:\\Full',
    groupTabs: true, chats: [{ conversationId: 'chatA', tabId: 77 }]
  };
  const api = async (route, method, body) => {
    calls.push({ route, method, body });
    if (route === '/full-project-mode/activate') return {
      ok: true,
      project: { ...hydrated, chats: [] },
      profile: { profileId: 'full', sessionSnapshots: true },
      orchestrationActivation: { state: 'ready-for-plan' }
    };
    if (route === '/projects') return { ok: true, projects: [hydrated] };
    return { ok: false, error: 'unexpected-route' };
  };
  const result = await controller.activate({
    conversationId: 'chatA',
    selectedProjectId: 'project:full',
    tab: { tabId: 77, title: 'Current Chat', url: 'https://chatgpt.com/c/a' }
  }, {
    api,
    groupTabs: async project => { grouped.push(project); return { ok: true }; },
    captureSnapshot: async projectId => { snapshots.push(projectId); return { ok: true }; },
    prependPrompt: text => { prepended.push(text); return { ok: true, executed: true }; }
  });

  assert.equal(result.ok, true);
  assert.equal(result.activated, true);
  assert.equal(result.project.chats.length, 1);
  assert.equal(result.completion.grouped, true);
  assert.equal(result.completion.snapshotCaptured, true);
  assert.equal(calls[0].route, '/full-project-mode/activate');
  assert.equal(calls[0].method, 'POST');
  assert.equal(calls[0].body.conversationId, 'chatA');
  assert.equal(calls[0].body.selectedProjectId, 'project:full');
  assert.equal(calls[1].route, '/projects');
  assert.equal(grouped[0].chats[0].tabId, 77);
  assert.deepEqual(snapshots, ['project:full']);
  assert.deepEqual(prepended, ['CHATSENTINEL FULL PROJECT MODE']);
});

test('browser controller stops before grouping, snapshot or prepend when activation fails', async () => {
  const controller = loadController();
  let secondaryEffects = 0;
  const result = await controller.activate({ conversationId: 'chatB' }, {
    api: async () => ({ ok: false, error: 'project-selection-required' }),
    groupTabs: async () => { secondaryEffects += 1; },
    captureSnapshot: async () => { secondaryEffects += 1; },
    prependPrompt: () => { secondaryEffects += 1; }
  });
  assert.deepEqual(result, { ok: false, error: 'project-selection-required' });
  assert.equal(secondaryEffects, 0);
});
