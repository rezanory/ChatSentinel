import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../extension/actuator.js', import.meta.url), 'utf8');

function loadActuator(initial = '') {
  const events = [];
  const composer = {
    value: initial,
    focusCalled: 0,
    focus() { this.focusCalled += 1; },
    dispatchEvent(event) { events.push(event.type); },
    getBoundingClientRect() { return { width: 100, height: 30 }; }
  };
  const sandbox = {
    console,
    document: {
      querySelector(selector) { return selector.includes('prompt-textarea') ? composer : null; },
      querySelectorAll() { return []; }
    },
    Event: class { constructor(type) { this.type = type; } },
    InputEvent: class { constructor(type) { this.type = type; } },
    getComputedStyle: () => ({ visibility: 'visible', display: 'block' }),
    sessionStorage: { getItem() { return null; }, setItem() {}, removeItem() {} }
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox);
  return { actuator: sandbox.ChatSentinelActuator, composer, events };
}
test('Full Project Mode is prepended without sending or overwriting the existing prompt', () => {
  const { actuator, composer, events } = loadActuator('Build the billing component');
  const result = actuator.prependPromptText('CHATSENTINEL FULL PROJECT MODE');
  assert.equal(result.ok, true);
  assert.equal(result.executed, true);
  assert.equal(composer.value, 'CHATSENTINEL FULL PROJECT MODE\n\nBuild the billing component');
  assert.equal(composer.focusCalled, 1);
  assert.deepEqual(events, ['input']);
});

test('Full Project Mode prepend is idempotent', () => {
  const { actuator, composer } = loadActuator('CHATSENTINEL FULL PROJECT MODE\n\nExisting request');
  const result = actuator.prependPromptText('CHATSENTINEL FULL PROJECT MODE');
  assert.equal(result.ok, true);
  assert.equal(result.deduplicated, true);
  assert.equal(composer.value, 'CHATSENTINEL FULL PROJECT MODE\n\nExisting request');
});
