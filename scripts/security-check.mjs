import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

const ROOT = path.resolve('.');
const EXPECTED_EXTENSION_ID = 'pcidbmcahljjpbmaecjmfmpbpfnpoepc';
const manifest = JSON.parse(await fs.readFile(path.join(ROOT, 'extension', 'manifest.json'), 'utf8'));
const pkg = JSON.parse(await fs.readFile(path.join(ROOT, 'package.json'), 'utf8'));

for (const script of manifest.content_scripts || []) {
  assert.deepEqual(script.matches, ['https://chatgpt.com/*'],
    'every production content script must inject only on chatgpt.com');
}
assert.ok(manifest.host_permissions.includes('http://127.0.0.1/*'),
  'loopback watchdog host permission is required');
assert.ok(typeof manifest.key === 'string' && manifest.key.length > 100,
  'stable extension public key is required');
assert.equal(extensionId(manifest.key), EXPECTED_EXTENSION_ID,
  'extension identity changed unexpectedly');
assert.equal(Object.keys(pkg.dependencies || {}).length, 0,
  'runtime dependencies must remain zero unless explicitly reviewed');
assert.equal(Object.keys(pkg.devDependencies || {}).length, 0,
  'dev dependencies must remain zero unless explicitly reviewed');
assert.equal(await fs.stat(path.join(ROOT, 'LICENSES', 'Sami21234-Chatgpt-Sidebar-MIT.txt')).then(() => true).catch(() => false), true,
  'MIT attribution file for adapted in-page sidebar pattern is required');
assert.equal(await fs.stat(path.join(ROOT, 'LICENSES', 'GoogleChrome-chrome-extensions-samples-Apache-2.0.txt')).then(() => true).catch(() => false), true,
  'Apache-2.0 license for adapted Chrome Tab Group sample is required');
assert.equal(await fs.stat(path.join(ROOT, 'LICENSES', '11me-light-session-MIT.txt')).then(() => true).catch(() => false), true,
  'MIT attribution file for adapted conversation-window trimming is required');
assert.equal(await fs.stat(path.join(ROOT, 'THIRD_PARTY_NOTICES.md')).then(() => true).catch(() => false), true,
  'THIRD_PARTY_NOTICES.md is required when adapted third-party patterns ship');

const productionFiles = await collectFiles(['src', 'extension']);
const externalNames = /KeepChatGPT|light-session|ChatGPT-Auto-Continue|plugin-chatgpt-automation|xcanwin|11me\/light-session|dizzpy|boringresearch/i;
const wildcardCors = /Access-Control-Allow-Origin['"\s,:=]*(?:['"]?\*)/i;
const privateKeyMaterial = /-----BEGIN (?:RSA )?PRIVATE KEY-----/;

for (const file of productionFiles) {
  const text = await fs.readFile(file, 'utf8');
  assert.equal(externalNames.test(text), false,
    `third-party project reference/source leaked into production code: ${file}`);
  assert.equal(wildcardCors.test(text), false,
    `wildcard CORS is forbidden in production code: ${file}`);
  assert.equal(privateKeyMaterial.test(text), false,
    `private key material must never be committed: ${file}`);
}

for (const file of await collectFiles(['.'])) {
  if (file.includes(`${path.sep}.git${path.sep}`) || file.includes(`${path.sep}node_modules${path.sep}`)) continue;
  const name = path.basename(file).toLowerCase();
  assert.equal(/private.*\.pem$/.test(name), false, `private PEM file must not exist in repository: ${file}`);
}

console.log(`ChatSentinel security policy: PASS (${productionFiles.length} production files, zero runtime dependencies, stable extension id ${EXPECTED_EXTENSION_ID})`);

function extensionId(publicKeyBase64) {
  const der = Buffer.from(publicKeyBase64, 'base64');
  const digest = createHash('sha256').update(der).digest().subarray(0, 16);
  const alphabet = 'abcdefghijklmnop';
  return [...digest].map(byte => alphabet[byte >> 4] + alphabet[byte & 15]).join('');
}

async function collectFiles(roots) {
  const files = [];
  for (const root of roots) {
    const absolute = path.join(ROOT, root);
    const stat = await fs.stat(absolute).catch(() => null);
    if (!stat) continue;
    if (stat.isFile()) files.push(absolute);
    else await walk(absolute, files);
  }
  return files.filter(file => /\.(?:js|mjs|json|pem)$/i.test(file));
}

async function walk(dir, files) {
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    if (entry.name === '.git' || entry.name === 'node_modules') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) await walk(full, files);
    else files.push(full);
  }
}
