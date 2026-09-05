import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { deviceProfile } from './device-profile.js';

export function detectPrerequisites(options = {}) {
  const profile = options.profile || deviceProfile(options);
  const run = options.run || defaultRun;
  const exists = options.exists || fs.existsSync;
  const env = options.env || process.env;
  const node = detectCommand('node', ['--version'], run, parseVersion);
  const git = detectCommand('git', ['--version'], run, parseVersion);
  const gh = detectCommand('gh', ['--version'], run, parseVersion);
  const packageManager = profile.platform === 'win32'
    ? detectCommand('winget', ['--version'], run, parseVersion)
    : profile.platform === 'darwin'
      ? detectCommand('brew', ['--version'], run, parseVersion)
      : { installed: false, command: null, version: null };
  const chrome = detectChrome(profile, { run, exists });
  const runner = detectRunner(profile, { exists, env, run });
  const remoteBridge = detectRemoteBridge(profile, { env, run });
  return {
    ok: true,
    profile,
    detectedAt: new Date().toISOString(),
    prerequisites: { node, git, chrome, gh, packageManager, runner, remoteBridge }
  };
}

function detectCommand(command, args, run, versionParser) {
  const result = run(command, args);
  return {
    installed: result.status === 0,
    command,
    version: result.status === 0 ? versionParser(`${result.stdout || ''} ${result.stderr || ''}`) : null
  };
}
function detectChrome(profile, { run, exists }) {
  const candidates = chromeCandidates(profile);
  for (const candidate of candidates) {
    if (candidate.kind === 'path' && exists(candidate.value)) {
      return { installed: true, path: candidate.value, version: null, source: 'path' };
    }
    if (candidate.kind === 'command') {
      const result = run(candidate.value, ['--version']);
      if (result.status === 0) return { installed: true, path: candidate.value, version: parseVersion(result.stdout || result.stderr), source: 'command' };
    }
  }
  return { installed: false, path: null, version: null, source: null };
}

function chromeCandidates(profile) {
  if (profile.platform === 'win32') {
    const roots = [process.env.PROGRAMFILES, process.env['PROGRAMFILES(X86)'], process.env.LOCALAPPDATA].filter(Boolean);
    return roots.map(root => ({ kind: 'path', value: path.join(root, 'Google', 'Chrome', 'Application', 'chrome.exe') }));
  }
  if (profile.platform === 'darwin') {
    return [
      { kind: 'path', value: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' },
      { kind: 'path', value: path.join(profile.home, 'Applications', 'Google Chrome.app', 'Contents', 'MacOS', 'Google Chrome') }
    ];
  }
  return [{ kind: 'command', value: 'google-chrome' }, { kind: 'command', value: 'chromium' }];
}

function detectRunner(profile, { exists, env, run }) {
  const runnerRoot = env.CHATSENTINEL_RUNNER_DIR || path.join(profile.dataDir, 'runner');
  const marker = path.join(runnerRoot, '.runner');
  const processDetected = runnerProcessDetected(profile, run);
  return {
    installed: Boolean(env.RUNNER_OS) || exists(marker) || processDetected,
    root: exists(runnerRoot) ? runnerRoot : null,
    serviceConfigured: exists(path.join(runnerRoot, '.service')) || Boolean(env.RUNNER_OS),
    currentProcessRunner: Boolean(env.RUNNER_OS),
    processDetected
  };
}

function detectRemoteBridge(profile, { env, run }) {
  if (env.CHATSENTINEL_REMOTE_BRIDGE === '1') return { installed: true, source: 'env' };
  if (profile.platform === 'win32') return { installed: false, source: null };
  const result = run('pgrep', ['-f', 'desktop-commander|wonderwhy-er']);
  const processDetected = result.status === 0 && /\d+/.test(result.stdout || '');
  return { installed: processDetected, source: processDetected ? 'process' : null };
}

function runnerProcessDetected(profile, run) {
  if (profile.platform === 'win32') {
    const result = run('tasklist', ['/FI', 'IMAGENAME eq Runner.Listener.exe', '/NH']);
    return result.status === 0 && /Runner\.Listener\.exe/i.test(result.stdout || '');
  }
  const result = run('pgrep', ['-f', 'Runner.Listener']);
  return result.status === 0 && /\d+/.test(result.stdout || '');
}
function parseVersion(value) {
  const match = String(value || '').match(/v?(\d+)\.(\d+)(?:\.(\d+))?/i);
  return match ? `${match[1]}.${match[2]}.${match[3] || '0'}` : null;
}

function defaultRun(command, args) {
  const result = spawnSync(command, args, { encoding: 'utf8', windowsHide: true, shell: false });
  return { status: Number.isInteger(result.status) ? result.status : 1, stdout: result.stdout || '', stderr: result.stderr || String(result.error || '') };
}

export function versionAtLeast(actual, minimum) {
  if (!actual || !minimum) return false;
  const a = actual.split('.').map(Number);
  const b = minimum.split('.').map(Number);
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    const av = a[i] || 0;
    const bv = b[i] || 0;
    if (av > bv) return true;
    if (av < bv) return false;
  }
  return true;
}
