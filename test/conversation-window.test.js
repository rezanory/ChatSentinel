import test from 'node:test';
import assert from 'node:assert/strict';

await import('../extension/components/conversation-window/trimmer.js');
const { trimConversation } = globalThis.ChatSentinelConversationTrimmer;

function makeConversation(visibleTurns = 20) {
  const mapping = { root: { parent: null, children: ['v1'] } };
  let previous = 'root';
  for (let index = 1; index <= visibleTurns; index += 1) {
    const id = `v${index}`;
    const nextVisible = index < visibleTurns ? `v${index + 1}` : null;
    mapping[id] = {
      parent: previous,
      children: nextVisible ? [nextVisible] : [],
      message: { author: { role: index % 2 ? 'user' : 'assistant' } }
    };
    previous = id;
  }
  return { mapping, current_node: `v${visibleTurns}`, root: 'root' };
}

test('conversation window keeps only the newest visible turns and preserves root anchor', () => {
  const result = trimConversation(makeConversation(20), 6);
  assert.ok(result);
  assert.equal(result.stats.visibleTotal, 20);
  assert.equal(result.stats.visibleKept, 6);
  assert.equal(result.stats.removedTurns, 14);
  assert.ok(result.data.mapping.root);
  assert.equal(result.data.mapping.root.parent, null);
  assert.equal(result.data.current_node, 'v20');
});

test('conversation window fails open for malformed conversation trees', () => {
  assert.equal(trimConversation({}, 10), null);
  assert.equal(trimConversation({ mapping: {}, current_node: 'missing' }, 10), null);
});

test('conversation window preserves hidden nodes inside the retained suffix', () => {
  const data = makeConversation(8);
  data.mapping.tool = {
    parent: 'v7',
    children: ['v8'],
    message: { author: { role: 'tool' } }
  };
  data.mapping.v7.children = ['tool'];
  data.mapping.v8.parent = 'tool';
  const result = trimConversation(data, 4);
  assert.ok(result.data.mapping.tool);
  assert.equal(result.stats.visibleKept, 4);
  assert.equal(result.data.mapping.tool.parent, 'v7');
  assert.deepEqual(result.data.mapping.tool.children, ['v8']);
});
