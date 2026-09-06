import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(
  new URL('../extension/components/chat-experience-guard/controller.js', import.meta.url),
  'utf8'
);

function loadApi() {
  const sandbox = {
    getComputedStyle: () => ({ display: 'block', visibility: 'visible' })
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox);
  return sandbox.ChatSentinelChatExperienceGuard;
}

function control(label, selected, region, onClick = () => {}) {
  return {
    innerText: label,
    textContent: label,
    parentElement: region,
    disabled: false,
    hidden: false,
    click: onClick,
    getBoundingClientRect: () => ({ top: 80, width: 60, height: 30 }),
    getAttribute(name) {
      if (name === 'aria-selected') return selected ? 'true' : 'false';
      return '';
    }
  };
}
test('Work-selected new chat is switched back to Chat before prompt delivery', () => {
  const api = loadApi();
  let chatClicks = 0;
  const region = { innerText: 'Chat Work', textContent: 'Chat Work', parentElement: null };
  const chat = control('Chat', false, region, () => { chatClicks += 1; });
  const work = control('Work', true, region);
  const root = { querySelectorAll: () => [chat, work] };
  const result = api.ensureChat(root);
  assert.equal(result.ok, true);
  assert.equal(result.changed, true);
  assert.equal(result.reason, 'switched-work-to-chat');
  assert.equal(chatClicks, 1);
});

test('already-selected Chat does not receive a redundant click', () => {
  const api = loadApi();
  let chatClicks = 0;
  const region = { innerText: 'Chat Work', textContent: 'Chat Work', parentElement: null };
  const chat = control('Chat', true, region, () => { chatClicks += 1; });
  const work = control('Work', false, region);
  const root = { querySelectorAll: () => [chat, work] };
  const result = api.ensureChat(root);
  assert.equal(result.changed, false);
  assert.equal(result.reason, 'chat-already-selected');
  assert.equal(chatClicks, 0);
});
