import test from 'node:test';
import assert from 'node:assert/strict';
import { RDC_TASK_NAME, remoteDesktopCommanderStatus, recoverRemoteDesktopCommander } from '../src/remote-desktop-commander-recovery.js';

test('RDC recovery is Windows-only and fails closed elsewhere', async () => {
  const status = await remoteDesktopCommanderStatus({ platform: 'linux' });
  assert.equal(status.ok, true);
  assert.equal(status.supported, false);
  const recovered = await recoverRemoteDesktopCommander({ platform: 'linux' });
  assert.equal(recovered.recovered, false);
  assert.equal(recovered.error, 'remote-desktop-commander-unsupported');
});

test('RDC recovery rejects missing or untrusted scheduled tasks', async () => {
  const missing = await recoverRemoteDesktopCommander({
    platform: 'win32',
    run: async () => ({ ok: true, supported: true, installed: false, validated: false, running: false })
  });
  assert.equal(missing.error, 'remote-desktop-commander-task-missing');

  const untrusted = await recoverRemoteDesktopCommander({
    platform: 'win32',
    run: async () => ({ ok: false, supported: true, installed: true, validated: false, running: false })
  });
  assert.equal(untrusted.error, 'remote-desktop-commander-task-untrusted');
});

test('RDC recovery restarts only a validated lightweight agent task', async () => {
  let calls = 0;
  const result = await recoverRemoteDesktopCommander({
    platform: 'win32',
    run: async () => {
      calls += 1;
      if (calls === 1) return { ok: true, supported: true, installed: true, validated: true, running: false, state: 'Ready' };
      return { ok: true, supported: true, installed: true, validated: true, running: true, state: 'Running', processCount: 1, restarted: true };
    }
  });
  assert.equal(calls, 2);
  assert.equal(result.recovered, true);
  assert.equal(result.taskName, RDC_TASK_NAME);
  assert.equal(result.running, true);
});
