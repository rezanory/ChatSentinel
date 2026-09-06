import test from 'node:test';
import assert from 'node:assert/strict';
import {
  reconcileProject,
  parsePorcelainStatus,
  clearReconciliationCache
} from '../src/project-reconciler.js';

function runnerFactory({ failRemote = false } = {}) {
  const calls = [];
  const runner = async (_cwd, args) => {
    calls.push(args.join(' '));
    const key = args.join(' ');
    if (key === 'rev-parse HEAD') return 'abc123';
    if (key === 'branch --show-current') return 'main';
    if (key === 'status --porcelain=v1') return 'M  staged.txt\n M unstaged.txt\n?? untracked.txt';
    if (key === 'remote get-url origin') return 'git@example/repo.git';
    if (key === 'ls-remote origin refs/heads/main') {
      if (failRemote) throw new Error('offline');
      return 'abc123\trefs/heads/main';
    }
    throw new Error(`unexpected git call: ${key}`);
  };
  return { runner, calls };
}
test('remote reconciliation is cached briefly while local head/status remain fresh', async () => {
  clearReconciliationCache();
  const { runner, calls } = runnerFactory();
  const first = await reconcileProject('C:/repo', { gitRunner: runner, now: 1_000, remoteTtlMs: 15_000 });
  const second = await reconcileProject('C:/repo', { gitRunner: runner, now: 5_000, remoteTtlMs: 15_000 });
  assert.equal(first.remoteHeadSource, 'network');
  assert.equal(second.remoteHeadSource, 'cache');
  assert.equal(second.remoteHeadFresh, true);
  assert.equal(calls.filter(value => value.startsWith('ls-remote')).length, 1);
  assert.equal(calls.filter(value => value === 'status --porcelain=v1').length, 2);
});

test('expired remote cache refreshes and stale fallback is never marked fresh', async () => {
  clearReconciliationCache();
  const good = runnerFactory();
  await reconcileProject('C:/repo', { gitRunner: good.runner, now: 1_000, remoteTtlMs: 2_000 });
  const offline = runnerFactory({ failRemote: true });
  const result = await reconcileProject('C:/repo', { gitRunner: offline.runner, now: 5_000, remoteTtlMs: 2_000 });
  assert.equal(result.remoteHead, 'abc123');
  assert.equal(result.remoteHeadFresh, false);
  assert.equal(result.remoteHeadSource, 'stale-cache');
});
test('porcelain status is summarized semantically instead of only boolean-diffed', () => {
  const summary = parsePorcelainStatus([
    'M  staged.txt',
    ' M unstaged.txt',
    '?? untracked.txt',
    'UU conflicted.txt'
  ].join('\n'));
  assert.deepEqual(summary, {
    total: 4,
    staged: 2,
    unstaged: 2,
    untracked: 1,
    conflicted: 1
  });
});
