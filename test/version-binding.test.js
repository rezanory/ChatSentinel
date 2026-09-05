import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const EXPECTED = '1.2.1';
const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const lock = JSON.parse(fs.readFileSync(new URL('../package-lock.json', import.meta.url), 'utf8'));
const manifest = JSON.parse(fs.readFileSync(new URL('../extension/manifest.json', import.meta.url), 'utf8'));
const runtime = fs.readFileSync(new URL('../src/runtime-config.js', import.meta.url), 'utf8');
const installer = fs.readFileSync(new URL('../scripts/install-autostart.ps1', import.meta.url), 'utf8');
const e2e = fs.readFileSync(new URL('../scripts/e2e/extension-smoke.js', import.meta.url), 'utf8');
const smoke = fs.readFileSync(new URL('../scripts/production-smoke.mjs', import.meta.url), 'utf8');

test('v1.2.1 release surfaces remain version-consistent', () => {
  assert.equal(pkg.version, EXPECTED);
  assert.equal(lock.version, EXPECTED);
  assert.equal(lock.packages?.['']?.version, EXPECTED);
  assert.equal(manifest.version, EXPECTED);
  assert.match(runtime, /VERSION\s*=\s*'1\.2\.1'/);
  assert.match(installer, /targetVersion\s*=\s*'1\.2\.1'/);
  assert.match(e2e, /health\.version,\s*'1\.2\.1'/);
  assert.match(e2e, /footerVersion[^\n]+v1\.2\.1|includes\('v1\.2\.1'\)/);
  assert.match(smoke, /health\.version,\s*'1\.2\.1'/);
});
