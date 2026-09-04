import test from 'node:test';
import assert from 'node:assert/strict';

await import('../extension/components/chat-control/controller.js');
const { execute } = globalThis.ChatSentinelChatControl;

function adapter(overrides = {}) {
  const progressEvents = [];
  return {
    progressEvents,
    resolveTarget: async () => ({ id: 7, url: 'https://chatgpt.com/c/7' }),
    focusTab: async tabId => ({ ok: true, tabId, reused: true }),
    reloadTab: async () => {},
    closeTab: async () => {},
    createReplacement: async () => ({ tabId: 9, conversationId: 'c:new', promptSent: true }),
    replaceStale: async () => ({ tabId: 9, conversationId: 'c:new', promptSent: true }),
    progress: async value => { progressEvents.push(value); },
    ...overrides
  };
}

test('focus recovers a stale tab by using the existing browser focus fallback', async () => {
  const calls = [];
  const a = adapter({
    resolveTarget: async () => null,
    focusTab: async (tabId, url) => { calls.push({ tabId, url }); return { ok: true, tabId: 12, reused: false }; }
  });
  const result = await execute({ type: 'FOCUS_CHAT', payload: { url: 'https://chatgpt.com/c/old' }, progress: {} }, a);
  assert.equal(result.staleRecovered, true);
  assert.deepEqual(calls, [{ tabId: undefined, url: 'https://chatgpt.com/c/old' }]);
  assert.equal(a.progressEvents[0].focusCompleted, true);
});

test('reload retries transient browser failures without duplicating queue/executor logic', async () => {
  let attempts = 0;
  const a = adapter({
    reloadTab: async () => {
      attempts += 1;
      if (attempts < 3) throw new Error('temporary-browser-error');
    }
  });
  const result = await execute(
    { type: 'RELOAD_CHAT', payload: { policy: { attempts: 3, retryDelayMs: 0 } }, progress: {} },
    a,
    { attempts: 3, retryDelayMs: 0 }
  );
  assert.equal(attempts, 3);
  assert.equal(result.reloaded, true);
  assert.equal(a.progressEvents[0].reloadCompleted, true);
});

test('reload replaces a stale tab through the injected replacement adapter', async () => {
  const a = adapter({ resolveTarget: async () => null });
  const result = await execute({ type: 'RELOAD_CHAT', payload: {}, progress: {} }, a, { retryDelayMs: 0 });
  assert.equal(result.staleRecovered, true);
  assert.equal(result.staleAction, 'replace');
  assert.equal(result.tabId, 9);
});

test('close treats a missing stale tab as an idempotent success state', async () => {
  const a = adapter({ resolveTarget: async () => null });
  const result = await execute({ type: 'CLOSE_CHAT', payload: {}, progress: {} }, a);
  assert.equal(result.closed, false);
  assert.equal(result.reason, 'already-closed');
  assert.equal(result.staleRecovered, true);
  assert.equal(a.progressEvents[0].closeCompleted, true);
});

test('replace creates replacement before closing old tab and preserves handoff result', async () => {
  const order = [];
  const a = adapter({
    createReplacement: async () => {
      order.push('create');
      return { tabId: 9, conversationId: 'c:new', promptSent: true };
    },
    closeTab: async tabId => { order.push(`close:${tabId}`); }
  });
  const result = await execute({ type: 'REPLACE_CHAT', payload: { closeOld: true }, progress: {} }, a);
  assert.deepEqual(order, ['create', 'close:7']);
  assert.equal(result.replacedTabId, 7);
  assert.equal(result.oldClosed, true);
  assert.equal(result.conversationId, 'c:new');
});

test('completed progress makes chat-control command replay idempotent', async () => {
  let resolved = 0;
  const a = adapter({ resolveTarget: async () => { resolved += 1; return { id: 7 }; } });
  const result = await execute({
    type: 'CLOSE_CHAT',
    payload: {},
    progress: { closeCompleted: true, result: { tabId: 7, closed: true } }
  }, a);
  assert.equal(resolved, 0);
  assert.equal(result.closed, true);
  assert.equal(result.idempotentReplay, true);
});
