import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { RDC_TASK_NAME, RDC_TASK_PATH, remoteDesktopCommanderStatus, recoverRemoteDesktopCommander } from '../src/remote-desktop-commander-recovery.js';

const source = fs.readFileSync(new URL('../src/remote-desktop-commander-recovery.js', import.meta.url), 'utf8');

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
  assert.equal(result.taskPath, RDC_TASK_PATH);
  assert.equal(result.running, true);
});

test('RDC PowerShell contract binds the root task and a real node remote-agent process', () => {
  assert.equal(RDC_TASK_NAME, 'DesktopCommander.RemoteAgent');
  assert.equal(RDC_TASK_PATH, '\\');
  assert.ok(source.includes("Name -ieq 'node.exe'"));
  assert.ok(source.includes('ExecutablePath -ieq $exe'));
  assert.ok(source.includes('@wonderwhy-er'));
  assert.ok(source.includes("$running=$validated -and ($task.State -eq 'Running') -and ($processCount -gt 0)"));
  assert.ok(source.includes('for($i=0;$i -lt 20;$i++)'));
});
