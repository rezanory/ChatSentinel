import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(
  new URL('../extension/components/tab-launch-guard/controller.js', import.meta.url),
  'utf8'
);

function loadApi() {
  const sandbox = { URL, setTimeout };
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox);
  return sandbox.ChatSentinelTabLaunchGuard;
}

test('new chat launch URL never carries prompt query or caller URL state', () => {
  const api = loadApi();
  const unsafe = 'https://chatgpt.com/?prompt-textarea=SECRET&foo=bar#draft';
  assert.equal(api.containsPromptInUrl(unsafe), true);
  assert.equal(api.safeNewChatUrl(unsafe), 'https://chatgpt.com/');
  assert.equal(api.safeNewChatUrl('https://example.com/?prompt=SECRET'), 'https://chatgpt.com/');
});

test('existing conversation fallback preserves only the conversation path', () => {
  const api = loadApi();
  assert.equal(
    api.safeExistingChatUrl('https://chatgpt.com/c/abc-123?prompt-textarea=SECRET#draft'),
    'https://chatgpt.com/c/abc-123'
  );
});

test('launch pacing enforces a minimum global gap', async () => {
  const api = loadApi();
  const values = new Map([[api.LAST_LAUNCH_KEY, 1000]]);
  const storage = {
    async get(key) { return { [key]: values.get(key) }; },
    async set(row) { for (const [key, value] of Object.entries(row)) values.set(key, value); }
  };
  const sleeps = [];
  const times = [4000, 7000];
  const slot = await api.acquireLaunchSlot(storage, async ms => sleeps.push(ms), () => times.shift(), 6000);
  assert.equal(slot.waitMs, 3000);
  assert.equal(slot.launchAt, 7000);
  assert.deepEqual(sleeps, [3000]);
  assert.equal(values.get(api.LAST_LAUNCH_KEY), 7000);
});

test('browser crash metadata is rejected before prompt delivery', () => {
  const api = loadApi();
  assert.equal(api.classifyTab({ url: 'chrome-error://chromewebdata/', title: 'Aw, Snap!' }).healthy, false);
  assert.equal(api.classifyTab({ url: 'https://chatgpt.com/', title: 'ChatGPT' }).healthy, true);
});

test('too-many-requests page is classified as rate limited', () => {
  const api = loadApi();
  const root = {
    body: { innerText: "Too many requests\nYou're making requests too quickly. Please wait a few minutes before trying again." }
  };
  const result = api.inspectPage(root);
  assert.equal(result.healthy, false);
  assert.equal(result.rateLimited, true);
  assert.equal(result.reason, 'chatgpt-rate-limited');
});

function fakeStorage() {
  const values = new Map();
  return {
    values,
    async get(key) { return { [key]: values.get(key) }; },
    async set(row) { for (const [key, value] of Object.entries(row)) values.set(key, value); },
    async remove(key) { values.delete(key); }
  };
}

test('same logical lane prompt is owned by only one live tab', async () => {
  const api = loadApi();
  const storage = fakeStorage();
  const payload = { projectId: 'p1', laneId: 'C1', prompt: 'build component' };
  const live = new Set([101, 202]);
  const getTab = async id => live.has(Number(id)) ? { id: Number(id) } : null;
  const first = await api.claimPromptOwnership(storage, payload, 101, getTab, { commandId: 'cmd-1' });
  assert.equal(first.allowed, true);
  const duplicate = await api.claimPromptOwnership(storage, payload, 202, getTab, { commandId: 'cmd-2' });
  assert.equal(duplicate.allowed, false);
  assert.equal(duplicate.reason, 'prompt-owned-by-live-tab');
  assert.equal(duplicate.owner.tabId, 101);
});

test('dead owner can be taken over but unrelated live owner cannot', async () => {
  const api = loadApi();
  const storage = fakeStorage();
  const payload = { projectId: 'p1', laneId: 'C1', prompt: 'build component' };
  const live = new Set([101]);
  const getTab = async id => live.has(Number(id)) ? { id: Number(id) } : null;
  await api.claimPromptOwnership(storage, payload, 101, getTab, { commandId: 'cmd-1' });
  live.delete(101);
  live.add(202);
  const takeover = await api.claimPromptOwnership(storage, payload, 202, getTab, { commandId: 'cmd-2' });
  assert.equal(takeover.allowed, true);
  assert.equal(takeover.previousOwner.tabId, 101);
});

test('explicit replace may transfer ownership from the old live tab', async () => {
  const api = loadApi();
  const storage = fakeStorage();
  const payload = { projectId: 'p1', laneId: 'C1', prompt: 'build component' };
  const getTab = async id => ({ id: Number(id) });
  await api.claimPromptOwnership(storage, payload, 101, getTab, { commandId: 'cmd-1' });
  const replacement = await api.claimPromptOwnership(storage, payload, 202, getTab, {
    commandId: 'cmd-2', replaceFromTabId: 101
  });
  assert.equal(replacement.allowed, true);
  assert.equal(replacement.explicitTakeover, true);
});

test('same text in different lanes has independent ownership', async () => {
  const api = loadApi();
  const storage = fakeStorage();
  const getTab = async id => ({ id: Number(id) });
  const a = await api.claimPromptOwnership(storage, { projectId: 'p1', laneId: 'C1', prompt: 'continue' }, 101, getTab);
  const b = await api.claimPromptOwnership(storage, { projectId: 'p1', laneId: 'C3', prompt: 'continue' }, 202, getTab);
  assert.equal(a.allowed, true);
  assert.equal(b.allowed, true);
  assert.notEqual(a.key, b.key);
});

test('crashed tab recovery escalates reload then replace then halt within one incident window', () => {
  const api = loadApi();
  const now = 100000;
  assert.equal(api.nextCrashRecoveryAction({}, now).action, 'reload-and-continue');
  assert.equal(api.nextCrashRecoveryAction({ attempts: 1, updatedAt: now - 1000 }, now).action, 'replace-and-continue');
  assert.equal(api.nextCrashRecoveryAction({ attempts: 2, updatedAt: now - 1000 }, now).action, 'halt');
  assert.equal(api.nextCrashRecoveryAction({ attempts: 2, updatedAt: now - api.CRASH_RECOVERY_WINDOW_MS - 1 }, now).action, 'reload-and-continue');
});

test('crash continuation explicitly resumes after reconciliation instead of replaying work', () => {
  const api = loadApi();
  const prompt = api.buildCrashContinuationPrompt({ branch: 'feat/c1', head: 'abc123' });
  assert.match(prompt, /^Continue\./);
  assert.match(prompt, /reconcile the real project state/i);
  assert.match(prompt, /do not repeat work or side effects/i);
  assert.match(prompt, /latest valid checkpoint/i);
  assert.match(prompt, /branch: feat\/c1/);
});

test('real browser crash titles and internal crash URLs are classified as crashes', () => {
  const api = loadApi();
  assert.equal(api.classifyTab({ url: 'https://chatgpt.com/c/abc', title: 'This page is having a problem' }).crashed, true);
  assert.equal(api.classifyTab({ url: 'chrome-error://chromewebdata/', title: 'ChatGPT' }).crashed, true);
  assert.equal(api.classifyTab({ url: 'https://chatgpt.com/c/abc', title: 'RESULT_CODE_HUNG' }).crashed, true);
});
