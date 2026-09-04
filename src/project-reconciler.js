import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export async function reconcileProject(projectPath) {
  if (!projectPath) return { ok: false, reason: 'project-path-missing' };

  try {
    const [head, branch, status, remote] = await Promise.all([
      git(projectPath, ['rev-parse', 'HEAD']),
      git(projectPath, ['branch', '--show-current']),
      git(projectPath, ['status', '--porcelain=v1']),
      git(projectPath, ['remote', 'get-url', 'origin'])
    ]);

    let remoteHead = null;
    try {
      remoteHead = await git(projectPath, ['ls-remote', 'origin', `refs/heads/${branch}`]);
      remoteHead = remoteHead.split(/\s+/)[0] || null;
    } catch {
      remoteHead = null;
    }

    return {
      ok: true,
      projectPath,
      head,
      branch,
      remote,
      remoteHead,
      clean: status.length === 0,
      aheadOrDiverged: Boolean(remoteHead && remoteHead !== head),
      status
    };
  } catch (error) {
    return { ok: false, projectPath, reason: 'git-reconcile-failed', error: error.message };
  }
}

async function git(cwd, args) {
  const { stdout } = await execFileAsync('git', ['-C', cwd, ...args], {
    windowsHide: true,
    timeout: 15000,
    maxBuffer: 1024 * 1024
  });
  return stdout.trim();
}
