import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { findBrowserExecutable, systemChromeCandidates, playwrightCacheCandidates, findPlaywrightChromium } from '../scripts/e2e/browser-paths.js';

test('system Chrome candidates cover native Windows, macOS and Linux locations', () => {
  const win = systemChromeCandidates('win32', {
    PROGRAMFILES: 'C:\\Program Files',
    'PROGRAMFILES(X86)': 'C:\\Program Files (x86)',
    LOCALAPPDATA: 'C:\\Users\\r\\AppData\\Local'
  }, 'C:\\Users\\r');
  assert.ok(win.some(value => value.endsWith(path.win32.join('Google', 'Chrome', 'Application', 'chrome.exe'))));

  const mac = systemChromeCandidates('darwin', {}, '/Users/r');
  assert.equal(mac[0], '/Applications/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing');
  assert.ok(mac.includes('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'));
  assert.ok(mac.some(value => value.includes('/Users/r/Applications/Google Chrome for Testing.app')));
  assert.ok(mac.some(value => value.includes('/Users/r/Applications/Google Chrome.app')));

  const linux = systemChromeCandidates('linux', {}, '/home/r');
  assert.ok(linux.includes('/usr/bin/google-chrome'));
  assert.ok(linux.includes('/usr/bin/chromium'));
});

test('Playwright cache candidates use native per-platform cache roots', () => {
  assert.deepEqual(playwrightCacheCandidates('darwin', {}, '/Users/r'), [path.posix.join('/Users/r', 'Library', 'Caches', 'ms-playwright')]);
  assert.deepEqual(playwrightCacheCandidates('linux', {}, '/home/r'), [path.posix.join('/home/r', '.cache', 'ms-playwright')]);
  assert.deepEqual(playwrightCacheCandidates('win32', { LOCALAPPDATA: 'C:\\Users\\r\\AppData\\Local' }, 'C:\\Users\\r'), [path.win32.join('C:\\Users\\r\\AppData\\Local', 'ms-playwright')]);
});

test('Playwright Chromium discovery covers macOS ARM64 app layout', async () => {
  const base = path.posix.join('/Users/r', 'Library', 'Caches', 'ms-playwright');
  const target = path.posix.join(base, 'chromium-1200', 'chrome-mac-arm64', 'Chromium.app', 'Contents', 'MacOS', 'Chromium');
  const found = await findPlaywrightChromium(base, 'darwin', {
    readdir: async () => ['chromium-1199', 'chromium-1200'],
    exists: async file => file === target
  });
  assert.equal(found, target);
});

test('browser discovery prefers Chrome for Testing over branded Chrome on macOS', async () => {
  const testing = '/Applications/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing';
  const branded = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  const found = await findBrowserExecutable({
    platform: 'darwin', home: '/Users/r', env: {},
    exists: async file => file === testing || file === branded,
    readdir: async () => []
  });
  assert.equal(found, testing);
});

test('browser discovery falls back to installed system Chrome when Playwright cache is absent', async () => {
  const system = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  let cacheRead = false;
  const found = await findBrowserExecutable({
    platform: 'darwin', home: '/Users/r', env: {},
    exists: async file => file === system,
    readdir: async () => { cacheRead = true; return []; }
  });
  assert.equal(found, system);
  assert.equal(cacheRead, true);
});
