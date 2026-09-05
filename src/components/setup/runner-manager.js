import path from 'node:path';

export function validateRepoSlug(value) {
  const text = String(value || '').trim().replace(/^https:\/\/github\.com\//i, '').replace(/\.git$/i, '');
  return /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(text) ? text : null;
}

export function runnerPlatform(profile) {
  const arch = profile.arch === 'arm64' ? 'arm64' : 'x64';
  if (profile.platform === 'darwin') return { os: 'osx', arch, ext: 'tar.gz' };
  if (profile.platform === 'win32') return { os: 'win', arch, ext: 'zip' };
  if (profile.platform === 'linux') return { os: 'linux', arch, ext: 'tar.gz' };
  return null;
}

export function buildRunnerPlan(options = {}) {
  const repo = validateRepoSlug(options.repo);
  const profile = options.profile;
  const target = profile && runnerPlatform(profile);
  if (!repo) return { ok: false, error: 'github-repo-required', steps: [] };
  if (!target) return { ok: false, error: 'unsupported-runner-platform', steps: [] };
  const root = options.runnerDir || path.join(profile.dataDir, 'runner');
  const labels = unique([...(profile.runnerLabels || []), ...(options.labels || [])]);
  return {
    ok: true,
    repo,
    root,
    name: options.name || profile.deviceId,
    labels,
    target,
    steps: [
      { id: 'runner:release', kind: 'resolve-release', approved: false },
      { id: 'runner:download', kind: 'download-runner', approved: false },
      { id: 'runner:register', kind: 'register-runner', approved: false },
      { id: 'runner:service', kind: 'install-runner-service', approved: false, requiresElevation: profile.platform === 'win32' }
    ]
  };
}

export function runnerAsset(version, target) {
  const clean = String(version || '').replace(/^v/, '');
  if (!/^\d+\.\d+\.\d+$/.test(clean) || !target) return null;
  return `actions-runner-${target.os}-${target.arch}-${clean}.${target.ext}`;
}
function unique(values) {
  return [...new Set(values.map(value => String(value || '').trim()).filter(Boolean))];
}
