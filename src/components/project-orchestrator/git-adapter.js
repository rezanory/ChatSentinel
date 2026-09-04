import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export async function inspectLaneBranch({ repoPath, worktreePath, branch, baselineSha }) {
  if (!repoPath || !branch) return { ok: false, reason: 'repo-path-or-branch-missing' };
  try {
    const remote = await git(repoPath, ['remote', 'get-url', 'origin']);
    const remoteRaw = await git(repoPath, ['ls-remote', 'origin', `refs/heads/${branch}`]);
    const remoteHead = remoteRaw.split(/\s+/)[0] || null;
    let localHead = null;
    let clean = undefined;
    if (worktreePath) {
      try {
        localHead = await git(worktreePath, ['rev-parse', 'HEAD']);
        const status = await git(worktreePath, ['status', '--porcelain=v1']);
        clean = status.length === 0;
      } catch {
        localHead = null;
      }
    }
    return {
      ok: true,
      branch,
      baselineSha,
      remote,
      remoteHead,
      localHead,
      clean,
      advanced: Boolean(remoteHead && baselineSha && remoteHead !== baselineSha)
    };
  } catch (error) {
    return { ok: false, branch, reason: 'lane-git-inspection-failed', error: error.message };
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
