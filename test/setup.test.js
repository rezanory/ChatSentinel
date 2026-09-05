import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs/promises';
import { defaultDataDir, deviceProfile } from '../src/components/setup/device-profile.js';
import { detectPrerequisites, versionAtLeast } from '../src/components/setup/prerequisite-detector.js';
import { buildSetupPlan, applySetupPlan, requirementAction } from '../src/components/setup/install-plan.js';
import { buildMaintenancePlan } from '../src/components/setup/maintenance-plan.js';
import { buildRunnerPlan, runnerAsset } from '../src/components/setup/runner-manager.js';

test('device profile uses native macOS data directory and runner labels', () => {
  const profile = deviceProfile({
    platform: 'darwin', arch: 'arm64', hostname: 'Mac Studio', home: '/Users/reza', env: {}
  });
  assert.equal(profile.dataDir, path.join('/Users/reza', 'Library', 'Application Support', 'ChatSentinel'));
  assert.equal(profile.deviceId, 'Mac-Studio-darwin-arm64');
  assert.deepEqual(profile.runnerLabels, ['self-hosted', 'macOS', 'ARM64', 'chatsentinel']);
  assert.equal(defaultDataDir('linux', {}, '/home/reza'), path.join('/home/reza', '.local', 'share', 'ChatSentinel'));
});

test('version comparison is numeric rather than lexical', () => {
  assert.equal(versionAtLeast('20.10.0', '20.2.0'), true);
  assert.equal(versionAtLeast('19.9.9', '20.0.0'), false);
  assert.equal(versionAtLeast('2.40.0', '2.40.0'), true);
});

test('prerequisite detector reports macOS tools without mutating the system', () => {
  const outputs = new Map([
    ['node --version', { status: 0, stdout: 'v22.16.0' }],
    ['git --version', { status: 0, stdout: 'git version 2.49.0' }],
    ['gh --version', { status: 1, stderr: 'missing' }],
    ['brew --version', { status: 0, stdout: 'Homebrew 4.6.1' }]
  ]);
  const run = (command, args) => outputs.get(`${command} ${args.join(' ')}`) || { status: 1, stderr: 'missing' };
  const exists = file => file === '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  const profile = deviceProfile({ platform: 'darwin', arch: 'arm64', hostname: 'mac', home: '/Users/r', env: {} });
  const report = detectPrerequisites({ profile, run, exists, env: {} });
  assert.equal(report.prerequisites.node.version, '22.16.0');
  assert.equal(report.prerequisites.git.installed, true);
  assert.equal(report.prerequisites.chrome.installed, true);
  assert.equal(report.prerequisites.gh.installed, false);
  assert.equal(report.prerequisites.packageManager.installed, true);
});
test('setup plan is approval-gated and dry-run by default', async () => {
  const report = {
    profile: deviceProfile({ platform: 'darwin', arch: 'arm64', hostname: 'mac', home: '/Users/r', env: {} }),
    prerequisites: {
      node: { installed: false },
      git: { installed: true, version: '2.49.0' },
      chrome: { installed: true },
      gh: { installed: false }
    }
  };
  const plan = buildSetupPlan(report, { includeRecommended: true, includeWatchdogService: true, root: '/opt/ChatSentinel' });
  assert.deepEqual(plan.steps.map(step => step.id), ['install:node', 'install:gh', 'service:watchdog']);
  const none = await applySetupPlan(plan, { approvedStepIds: [] });
  assert.ok(none.results.every(row => row.status === 'skipped'));
  const approved = await applySetupPlan(plan, { approvedStepIds: ['install:node'] });
  assert.equal(approved.results[0].status, 'planned');
  assert.match(approved.results[0].command, /^brew install node$/);
  assert.equal(approved.results[1].status, 'skipped');
});

test('runner plan selects native macOS ARM64 asset and preserves labels', () => {
  const profile = deviceProfile({ platform: 'darwin', arch: 'arm64', hostname: 'mac-2', home: '/Users/r', env: {} });
  const plan = buildRunnerPlan({ repo: 'rezanory/ChatSentinel', profile, labels: ['chatsentinel-mac', 'project-a'] });
  assert.equal(plan.ok, true);
  assert.equal(plan.target.os, 'osx');
  assert.equal(plan.target.arch, 'arm64');
  assert.ok(plan.labels.includes('chatsentinel-mac'));
  assert.ok(plan.labels.includes('project-a'));
  assert.equal(runnerAsset('v2.330.0', plan.target), 'actions-runner-osx-arm64-2.330.0.tar.gz');
});

test('runner plan rejects unsafe or incomplete GitHub repository identifiers', () => {
  const profile = deviceProfile({ platform: 'win32', arch: 'x64', hostname: 'win', home: 'C:\\Users\\r', env: { LOCALAPPDATA: 'C:\\Users\\r\\AppData\\Local' } });
  assert.equal(buildRunnerPlan({ repo: 'not-a-repo', profile }).ok, false);
  assert.equal(buildRunnerPlan({ repo: 'https://github.com/rezanory/ChatSentinel.git', profile }).repo, 'rezanory/ChatSentinel');
});

test('outdated required tools produce update steps instead of reinstall steps', () => {
  const report = {
    profile: deviceProfile({ platform: 'win32', arch: 'x64', hostname: 'win', home: 'C:\\Users\\r', env: { LOCALAPPDATA: 'C:\\Users\\r\\AppData\\Local' } }),
    prerequisites: {
      node: { installed: true, version: '18.19.0' },
      git: { installed: true, version: '2.49.0' },
      chrome: { installed: true },
      gh: { installed: true, version: '2.96.0' }
    }
  };
  assert.equal(requirementAction('node', report.prerequisites.node), 'update');
  const plan = buildSetupPlan(report, { includeRecommended: true });
  assert.equal(plan.steps[0].id, 'update:node');
  assert.equal(plan.steps[0].command, 'winget');
  assert.equal(plan.steps[0].args[0], 'upgrade');
});

test('maintenance uninstall removes only ChatSentinel-owned service configuration', () => {
  const report = { profile: deviceProfile({ platform: 'darwin', arch: 'arm64', hostname: 'mac', home: '/Users/r', env: {} }), prerequisites: {} };
  const plan = buildMaintenancePlan(report, { action: 'uninstall', root: '/opt/ChatSentinel' });
  assert.equal(plan.ok, true);
  assert.deepEqual(plan.steps.map(step => step.id), ['service:watchdog:remove']);
  assert.equal(plan.steps[0].command, 'bash');
  assert.ok(plan.notes.some(note => /Shared prerequisites/.test(note)));
});

test('missing package manager is represented explicitly before package installation', async () => {
  const macReport = {
    profile: deviceProfile({ platform: 'darwin', arch: 'arm64', hostname: 'mac', home: '/Users/r', env: {} }),
    prerequisites: {
      node: { installed: true, version: '22.0.0' }, git: { installed: true, version: '2.49.0' },
      chrome: { installed: false }, gh: { installed: false }, packageManager: { installed: false }
    }
  };
  const macPlan = buildSetupPlan(macReport, { root: '/opt/ChatSentinel' });
  assert.equal(macPlan.steps[0].id, 'install:homebrew');
  assert.equal(macPlan.steps[1].id, 'install:chrome');

  const winReport = {
    profile: deviceProfile({ platform: 'win32', arch: 'x64', hostname: 'win', home: 'C:\\Users\\r', env: { LOCALAPPDATA: 'C:\\Users\\r\\AppData\\Local' } }),
    prerequisites: {
      node: { installed: false }, git: { installed: true, version: '2.49.0' },
      chrome: { installed: true }, gh: { installed: true, version: '2.96.0' }, packageManager: { installed: false }
    }
  };
  const winPlan = buildSetupPlan(winReport, {});
  assert.equal(winPlan.steps[0].id, 'manual:winget');
  const applied = await applySetupPlan(winPlan, { approvedStepIds: ['manual:winget'], dryRun: false });
  assert.equal(applied.results[0].status, 'manual-required');
});

test('Windows prerequisite detector can recognize an authorized Remote Desktop Commander process', () => {
  const outputs = new Map([
    ['node --version', { status: 0, stdout: 'v22.16.0' }],
    ['git --version', { status: 0, stdout: 'git version 2.54.0' }],
    ['gh --version', { status: 0, stdout: 'gh version 2.96.0' }],
    ['winget --version', { status: 0, stdout: 'v1.10.340' }],
    ['tasklist /FI IMAGENAME eq Runner.Listener.exe /NH', { status: 1, stdout: '' }]
  ]);
  const run = (command, args) => {
    if (command === 'powershell.exe' && args.includes('-Command')) return { status: 0, stdout: '6932\n' };
    return outputs.get(`${command} ${args.join(' ')}`) || { status: 1, stderr: 'missing' };
  };
  const profile = deviceProfile({ platform: 'win32', arch: 'x64', hostname: 'win', home: 'C:\\Users\\r', env: { LOCALAPPDATA: 'C:\\Users\\r\\AppData\\Local' } });
  const exists = file => /Google\\Chrome\\Application\\chrome\.exe$/i.test(file);
  const report = detectPrerequisites({ profile, run, exists, env: {} });
  assert.equal(report.prerequisites.remoteBridge.installed, true);
  assert.equal(report.prerequisites.remoteBridge.source, 'process');
});


test('Windows upgrade installer retires a supervisor rooted at an older installation before listener recycle', async () => {
  const source = await fs.readFile(new URL('../scripts/install-autostart.ps1', import.meta.url), 'utf8');
  const handoff = source.indexOf('retiring stale supervisor PID');
  const recycle = source.indexOf('upgrading listener from v');
  assert.ok(handoff >= 0, 'stale supervisor handoff must be explicit');
  assert.ok(recycle > handoff, 'stale supervisor must be retired before listener recycle');
  assert.match(source, /Get-CimInstance Win32_Process/);
  assert.match(source, /run-watchdog\\\.ps1/);
});

test('setup CLI returns a failing process status when an approved apply result is not ok', async () => {
  const source = await fs.readFile(new URL('../scripts/setup-cli.mjs', import.meta.url), 'utf8');
  const matches = source.match(/if \(!result\.ok\) process\.exitCode = 1;/g) || [];
  assert.equal(matches.length, 2);
});
