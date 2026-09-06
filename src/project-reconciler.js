import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const DEFAULT_REMOTE_TTL_MS = 15_000;
const MAX_REMOTE_CACHE = 128;
const remoteCache = new Map();
const counters = {
  remoteLookups: 0,
  remoteCacheHits: 0,
  remoteCacheMisses: 0,
  remoteFailures: 0
};

export async function reconcileProject(projectPath, options = {}) {
  if (!projectPath) return { ok: false, reason: 'project-path-missing' };
  const runner = options.gitRunner || git;
  const now = Number(options.now ?? Date.now());
  const remoteTtlMs = boundedTtl(options.remoteTtlMs);

  try {
    const [head, branch, status, remote] = await Promise.all([
      runner(projectPath, ['rev-parse', 'HEAD']),
      runner(projectPath, ['branch', '--show-current']),
      runner(projectPath, ['status', '--porcelain=v1']),
      runner(projectPath, ['remote', 'get-url', 'origin'])
    ]);
    const remoteEvidence = await remoteHeadFor({
      projectPath,
      remote,
      branch,
      runner,
      now,
      remoteTtlMs,
      forceRemote: options.forceRemote === true
    });
    const changeSummary = parsePorcelainStatus(status);
    const remoteHead = remoteEvidence.remoteHead;

    return {
      ok: true,
      projectPath,
      head,
      branch,
      remote,
      remoteHead,
      remoteHeadFresh: remoteEvidence.fresh,
      remoteHeadSource: remoteEvidence.source,
      clean: changeSummary.total === 0,
      aheadOrDiverged: Boolean(remoteHead && remoteHead !== head),
      changeSummary,
      status
    };
  } catch (error) {
    return { ok: false, projectPath, reason: 'git-reconcile-failed', error: error.message };
  }
}
async function remoteHeadFor({ projectPath, remote, branch, runner, now, remoteTtlMs, forceRemote }) {
  const key = `${projectPath}\u0000${remote}\u0000${branch}`;
  const cached = remoteCache.get(key);
  if (!forceRemote && cached && now - cached.checkedAt <= remoteTtlMs) {
    counters.remoteCacheHits += 1;
    return { remoteHead: cached.remoteHead, fresh: true, source: 'cache' };
  }

  counters.remoteCacheMisses += 1;
  counters.remoteLookups += 1;
  try {
    const raw = await runner(projectPath, ['ls-remote', 'origin', `refs/heads/${branch}`]);
    const remoteHead = raw.split(/\s+/)[0] || null;
    remoteCache.set(key, { remoteHead, checkedAt: now });
    pruneRemoteCache();
    return { remoteHead, fresh: true, source: 'network' };
  } catch {
    counters.remoteFailures += 1;
    if (cached) return { remoteHead: cached.remoteHead, fresh: false, source: 'stale-cache' };
    return { remoteHead: null, fresh: false, source: 'unavailable' };
  }
}

export function parsePorcelainStatus(status = '') {
  const summary = { total: 0, staged: 0, unstaged: 0, untracked: 0, conflicted: 0 };
  const conflicts = new Set(['DD', 'AU', 'UD', 'UA', 'DU', 'AA', 'UU']);
  for (const line of String(status || '').split(/\r?\n/)) {
    if (!line) continue;
    const code = line.slice(0, 2);
    if (code === '!!') continue;
    summary.total += 1;
    if (code === '??') {
      summary.untracked += 1;
      continue;
    }
    if (conflicts.has(code)) summary.conflicted += 1;
    const index = code[0] || ' ';
    const worktree = code[1] || ' ';
    if (index !== ' ' && index !== '?') summary.staged += 1;
    if (worktree !== ' ' && worktree !== '?') summary.unstaged += 1;
  }
  return summary;
}

export function reconciliationMetrics() {
  return { ...counters, remoteCacheEntries: remoteCache.size };
}

export function clearReconciliationCache() {
  remoteCache.clear();
}

function boundedTtl(value) {
  const number = Number(value ?? DEFAULT_REMOTE_TTL_MS);
  return Math.max(1000, Math.min(5 * 60_000, Number.isFinite(number) ? number : DEFAULT_REMOTE_TTL_MS));
}
function pruneRemoteCache() {
  while (remoteCache.size > MAX_REMOTE_CACHE) {
    const oldest = remoteCache.keys().next().value;
    if (oldest === undefined) break;
    remoteCache.delete(oldest);
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
