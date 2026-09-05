#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const flags = parseArgs(process.argv.slice(2));
const version = String(flags.version || '').trim();
const ref = String(flags.ref || 'HEAD').trim();
if (!/^\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.-]+)?$/.test(version)) fail('--version must be semver-like');
if (!/^[A-Za-z0-9._\/-]+$/.test(ref)) fail('--ref contains unsupported characters');
const root = path.resolve('.');
const destination = path.resolve(flags.destination || path.join(path.dirname(root), 'ChatSentinel-versions', `ChatSentinel-${version}`));
await fs.mkdir(destination, { recursive: true });

const sha = (await git(['rev-parse', ref])).trim();
const tree = (await git(['rev-parse', `${ref}^{tree}`])).trim();
const sourceZip = path.join(destination, `ChatSentinel-${version}-source.zip`);
const extensionZip = path.join(destination, `ChatSentinel-${version}-extension.zip`);
const bundle = path.join(destination, `ChatSentinel-${version}.bundle`);

await git(['archive', '--format=zip', `--output=${sourceZip}`, `--prefix=ChatSentinel-${version}/`, ref]);
await git(['archive', '--format=zip', `--output=${extensionZip}`, `--prefix=ChatSentinel-${version}-extension/`, ref, 'extension']);
await git(['bundle', 'create', bundle, ref]);
const files = [sourceZip, extensionZip, bundle];
const sums = [];
for (const file of files) {
  sums.push(`${await sha256(file)}  ${path.basename(file)}`);
}
await fs.writeFile(path.join(destination, 'SHA256SUMS.txt'), `${sums.join('\n')}\n`, 'utf8');
await fs.writeFile(path.join(destination, 'MANIFEST.json'), `${JSON.stringify({
  product: 'ChatSentinel',
  version,
  ref,
  sha,
  tree,
  createdAt: new Date().toISOString(),
  artifacts: files.map(file => path.basename(file))
}, null, 2)}\n`, 'utf8');
await fs.writeFile(path.join(destination, 'INSTALL.txt'), [
  `ChatSentinel ${version} archive`,
  `Canonical ref: ${ref}`,
  `SHA: ${sha}`,
  '',
  'Chrome extension: extract the extension ZIP, open chrome://extensions, enable Developer mode, then Load unpacked.',
  'Full source: extract the source ZIP.',
  `Offline Git restore: git clone ChatSentinel-${version}.bundle ChatSentinel-${version}`,
  '',
  'Verify SHA256SUMS.txt before use. Do not develop inside an immutable baseline archive.'
].join('\n') + '\n', 'utf8');
console.log(JSON.stringify({ ok: true, version, ref, sha, tree, destination, artifacts: files }, null, 2));

async function git(args) {
  const result = await execFileAsync('git', args, { cwd: root, encoding: 'utf8' });
  return result.stdout || '';
}

async function sha256(file) {
  const data = await fs.readFile(file);
  return crypto.createHash('sha256').update(data).digest('hex').toUpperCase();
}
function parseArgs(values) {
  const result = {};
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (!value.startsWith('--')) continue;
    const key = value.slice(2);
    const next = values[index + 1];
    if (!next || next.startsWith('--')) result[key] = true;
    else { result[key] = next; index += 1; }
  }
  return result;
}

function fail(message) {
  console.error(JSON.stringify({ ok: false, error: message }, null, 2));
  process.exit(1);
}
