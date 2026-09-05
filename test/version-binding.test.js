import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const lock = JSON.parse(fs.readFileSync(new URL('../package-lock.json', import.meta.url), 'utf8'));
const manifest = JSON.parse(fs.readFileSync(new URL('../extension/manifest.json', import.meta.url), 'utf8'));
const runtime = fs.readFileSync(new URL('../src/runtime-config.js', import.meta.url), 'utf8');
const installer = fs.readFileSync(new URL('../scripts/install-autostart.ps1', import.meta.url), 'utf8');
const e2e = fs.readFileSync(new URL('../scripts/e2e/extension-smoke.js', import.meta.url), 'utf8');
const smoke = fs.readFileSync(new URL('../scripts/production-smoke.mjs', import.meta.url), 'utf8');
const EXPECTED = String(pkg.version || '');
const VERSION_PATTERN = EXPECTED.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

test('release surfaces remain version-consistent after candidate integration', () => {
  assert.match(EXPECTED, /^\d+\.\d+\.\d+$/);
  assert.equal(lock.version, EXPECTED);
  assert.equal(lock.packages?.['']?.version, EXPECTED);
  assert.equal(manifest.version, EXPECTED);
  assert.match(runtime, new RegExp(`VERSION\\s*=\\s*'${VERSION_PATTERN}'`));
  assert.match(installer, new RegExp(`targetVersion\\s*=\\s*'${VERSION_PATTERN}'`));
  assert.match(e2e, new RegExp(`health\\.version,\\s*'${VERSION_PATTERN}'`));
  assert.match(e2e, new RegExp(`footerVersion[^\\n]+v${VERSION_PATTERN}|includes\\('v${VERSION_PATTERN}'\\)`));
  assert.match(smoke, new RegExp(`health\\.version,\\s*'${VERSION_PATTERN}'`));
});
