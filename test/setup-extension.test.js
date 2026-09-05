import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const manifest = JSON.parse(fs.readFileSync(new URL('../extension/manifest.json', import.meta.url), 'utf8'));
const html = fs.readFileSync(new URL('../extension/setup.html', import.meta.url), 'utf8');
const setupJs = fs.readFileSync(new URL('../extension/setup.js', import.meta.url), 'utf8');
const consoleJs = fs.readFileSync(new URL('../extension/project-console.js', import.meta.url), 'utf8');
const fullModeJs = fs.readFileSync(new URL('../extension/components/full-project-mode/controller.js', import.meta.url), 'utf8');

test('extension exposes a dedicated Setup Assistant without inline install execution', () => {
  assert.equal(manifest.options_page, 'setup.html');
  assert.match(html, /ChatSentinel Setup Assistant/);
  assert.match(html, /<script src="setup\.js"><\/script>/);
  assert.doesNotMatch(html, /<script>(.|\n)*<\/script>/);
  assert.match(setupJs, /\/setup\/plan\?service=1/);
  assert.doesNotMatch(setupJs, /winget\s+install|brew\s+install|exec\(|spawn\(/);
});

test('project console wires one-click real Full Project Mode activation and Setup Assistant', () => {
  assert.match(consoleJs, /id="insertFullProjectMode"/);
  assert.match(consoleJs, /ChatSentinelFullProjectMode/);
  assert.match(fullModeJs, /CHATSENTINEL FULL PROJECT MODE/);
  assert.match(fullModeJs, /\/full-project-mode\/activate/);
  assert.ok(manifest.content_scripts.some(script =>
    script.js?.includes('components/full-project-mode/controller.js')));
  assert.match(consoleJs, /id="openSetupAssistant"/);
  assert.match(consoleJs, /chrome\.runtime\.openOptionsPage\(\)/);
});
