import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

test('version archiver creates source, extension, bundle, manifest and checksums from an exact ref', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'chatsentinel-archive-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }).catch(() => {}));
  const ref = (await execFileAsync('git', ['rev-parse', 'HEAD'], { cwd: path.resolve('.'), encoding: 'utf8' })).stdout.trim();
  const expectedExtensionVersion = JSON.parse(await fs.readFile('extension/manifest.json', 'utf8')).version;
  const version = '1.2.0-test';
  const { stdout } = await execFileAsync(process.execPath, [
    'scripts/archive-version.mjs', '--version', version, '--ref', ref, '--destination', dir
  ], { cwd: path.resolve('.'), encoding: 'utf8' });
  const result = JSON.parse(stdout);
  assert.equal(result.ok, true);
  const manifest = JSON.parse(await fs.readFile(path.join(dir, 'MANIFEST.json'), 'utf8'));
  assert.equal(manifest.version, version);
  assert.equal(manifest.ref, ref);
  assert.match(manifest.sha, /^[a-f0-9]{40}$/);
  assert.match(await fs.readFile(path.join(dir, 'SHA256SUMS.txt'), 'utf8'), /ChatSentinel-1\.2\.0-test-source\.zip/);
  for (const name of [
    'ChatSentinel-1.2.0-test-source.zip',
    'ChatSentinel-1.2.0-test-extension.zip',
    'ChatSentinel-1.2.0-test.bundle'
  ]) assert.ok((await fs.stat(path.join(dir, name))).size > 0);
  assert.ok((await fs.stat(path.join(dir, 'INSTALL.txt'))).size > 0);
  const installDir = path.join(dir, 'installed');
  const installed = await execFileAsync(process.execPath, [
    'scripts/install-archived-version.mjs', '--archive', dir, '--destination', installDir, '--execute'
  ], { cwd: path.resolve('.'), encoding: 'utf8' });
  const installResult = JSON.parse(installed.stdout);
  assert.equal(installResult.installed, true);
  const installedManifest = JSON.parse(await fs.readFile(path.join(installResult.installRoot, 'extension', 'manifest.json'), 'utf8'));
  assert.equal(installedManifest.version, expectedExtensionVersion);
});
