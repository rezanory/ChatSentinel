#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { deviceProfile } from '../src/components/setup/device-profile.js';
import { buildRunnerPlan, runnerAsset } from '../src/components/setup/runner-manager.js';

const execFileAsync = promisify(execFile);
const flags = parseArgs(process.argv.slice(2));
const profile = deviceProfile();
const plan = buildRunnerPlan({
  repo: flags.repo,
  profile,
  name: flags.name,
  labels: splitCsv(flags.labels),
  runnerDir: flags.dir
});
if (!plan.ok) fail(plan.error);

if (!flags.apply) {
  console.log(JSON.stringify({ ...plan, applyRequired: true }, null, 2));
  process.exit(0);
}

await requireCommand('gh', ['auth', 'status']);
if (profile.platform === 'win32' && flags.service) await requireWindowsAdmin();
if (await exists(path.join(plan.root, '.runner')) && !flags.replace) {
  fail('runner-already-configured; re-run with --replace only if replacement is intended');
}
const tag = (await gh(['api', 'repos/actions/runner/releases/latest', '--jq', '.tag_name'])).trim();
const asset = runnerAsset(tag, plan.target);
if (!asset) fail('runner-release-resolution-failed');
await fs.mkdir(plan.root, { recursive: true });
const archive = path.join(plan.root, asset);
await gh(['release', 'download', tag, '--repo', 'actions/runner', '--pattern', asset, '--dir', plan.root, '--clobber']);
await extractArchive(archive, plan.root, profile.platform);

const registrationToken = (await gh([
  'api', '-X', 'POST', `repos/${plan.repo}/actions/runners/registration-token`, '--jq', '.token'
])).trim();
if (!registrationToken) fail('runner-registration-token-missing');

const configScript = profile.platform === 'win32' ? path.join(plan.root, 'config.cmd') : path.join(plan.root, 'config.sh');
const configArgs = [
  '--unattended',
  '--url', `https://github.com/${plan.repo}`,
  '--token', registrationToken,
  '--name', plan.name,
  '--labels', plan.labels.join(','),
  '--work', '_work'
];
if (flags.replace) configArgs.push('--replace');
if (profile.platform === 'win32' && flags.service) configArgs.push('--runasservice');
await runConfig(configScript, configArgs, profile.platform, plan.root);
if (profile.platform === 'darwin' && flags.service) {
  const svc = path.join(plan.root, 'svc.sh');
  await execFileAsync(svc, ['install'], { cwd: plan.root });
  await execFileAsync(svc, ['start'], { cwd: plan.root });
}

console.log(JSON.stringify({
  ok: true,
  repo: plan.repo,
  runnerRoot: plan.root,
  runnerName: plan.name,
  labels: plan.labels,
  version: tag,
  serviceRequested: Boolean(flags.service),
  configured: true
}, null, 2));

async function extractArchive(archive, root, platform) {
  if (platform === 'win32') {
    await execFileAsync('powershell.exe', ['-NoProfile', '-Command', `Expand-Archive -LiteralPath '${escapePs(archive)}' -DestinationPath '${escapePs(root)}' -Force`]);
    return;
  }
  await execFileAsync('tar', ['xzf', archive, '-C', root]);
}

async function runConfig(script, args, platform, cwd) {
  if (platform === 'win32') {
    await execFileAsync('cmd.exe', ['/d', '/s', '/c', script, ...args], { cwd });
    return;
  }
  await execFileAsync(script, args, { cwd });
}
async function requireWindowsAdmin() {
  const command = '[Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent() | ForEach-Object { $_.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator) }';
  const result = await execFileAsync('powershell.exe', ['-NoProfile', '-Command', command], { encoding: 'utf8' });
  if (!/^True$/im.test(result.stdout || '')) fail('windows-runner-service-requires-administrator');
}

async function requireCommand(command, args) {
  try { await execFileAsync(command, args); }
  catch { fail(`${command}-required-or-not-authenticated`); }
}

async function gh(args) {
  const result = await execFileAsync('gh', args, { encoding: 'utf8' });
  return result.stdout || '';
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

function splitCsv(value) {
  return String(value || '').split(',').map(item => item.trim()).filter(Boolean);
}
function escapePs(value) {
  return String(value).replace(/'/g, "''");
}

function fail(message) {
  console.error(JSON.stringify({ ok: false, error: message }, null, 2));
  process.exit(1);
}
