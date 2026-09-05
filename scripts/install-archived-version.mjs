#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const flags = parseArgs(process.argv.slice(2));
if (!flags.archive) fail('--archive is required');
if (!flags.destination) fail('--destination is required');
const archiveDir = path.resolve(flags.archive);
const destination = path.resolve(flags.destination);
const manifest = JSON.parse(await fs.readFile(path.join(archiveDir, 'MANIFEST.json'), 'utf8').catch(async () => {
  const legacy = await fs.readFile(path.join(archiveDir, 'MANIFEST.txt'), 'utf8');
  const values = Object.fromEntries(legacy.split(/\r?\n/).map(line => line.split('=', 2)).filter(row => row.length === 2));
  return JSON.stringify({ version: values.version, sha: values.sha, ref: values.remote_branch || values.ref });
}));
const version = String(manifest.version || '').trim();
if (!version) fail('archive-version-missing');
await verifyChecksums(archiveDir);
const zipName = flags['extension-only'] ? `ChatSentinel-${version}-extension.zip` : `ChatSentinel-${version}-source.zip`;
const zipPath = path.join(archiveDir, zipName);
await fs.access(zipPath).catch(() => fail(`archive-artifact-missing:${zipName}`));
const plan = { ok: true, version, sha: manifest.sha, source: zipPath, destination, extensionOnly: Boolean(flags['extension-only']), executeRequired: true };
if (!flags.execute) {
  console.log(JSON.stringify(plan, null, 2));
  process.exit(0);
}
if (await exists(destination)) {
  const entries = await fs.readdir(destination);
  if (entries.length && !flags.replace) fail('destination-not-empty; use --replace only for an intentional side-by-side reinstall');
  if (flags.replace) await fs.rm(destination, { recursive: true, force: true });
}
await fs.mkdir(destination, { recursive: true });
await extractZip(zipPath, destination);
const children = await fs.readdir(destination, { withFileTypes: true });
const singleDirectory = children.length === 1 && children[0].isDirectory()
  ? path.join(destination, children[0].name)
  : destination;
console.log(JSON.stringify({ ...plan, ok: true, installed: true, installRoot: singleDirectory }, null, 2));

async function verifyChecksums(dir) {
  const text = await fs.readFile(path.join(dir, 'SHA256SUMS.txt'), 'utf8');
  for (const line of text.split(/\r?\n/).filter(Boolean)) {
    const match = line.match(/^([A-Fa-f0-9]{64})\s+(.+)$/);
    if (!match) fail(`invalid-checksum-line:${line}`);
    const file = path.join(dir, match[2].trim());
    const actual = await sha256(file);
    if (actual.toLowerCase() !== match[1].toLowerCase()) fail(`checksum-mismatch:${match[2].trim()}`);
  }
}

async function extractZip(file, target) {
  if (process.platform === 'win32') {
    const command = `Expand-Archive -LiteralPath '${escapePs(file)}' -DestinationPath '${escapePs(target)}' -Force`;
    await execFileAsync('powershell.exe', ['-NoProfile', '-Command', command]);
    return;
  }
  await execFileAsync('unzip', ['-q', file, '-d', target]);
}
async function sha256(file) {
  const data = await fs.readFile(file);
  return crypto.createHash('sha256').update(data).digest('hex');
}

async function exists(file) {
  try { await fs.access(file); return true; }
  catch { return false; }
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

function escapePs(value) {
  return String(value).replace(/'/g, "''");
}

function fail(message) {
  console.error(JSON.stringify({ ok: false, error: message }, null, 2));
  process.exit(1);
}
