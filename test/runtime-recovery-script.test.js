import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('../scripts/recover-runtime.ps1', import.meta.url), 'utf8');

test('Windows runtime recovery restores persistence before restart', () => {
  assert.match(source, /ChatSentinelWatchdog/);
  assert.match(source, /Get-ScheduledTask/);
  assert.match(source, /schtasks\.exe \/Create/);
  assert.match(source, /ChatSentinelWatchdog\.vbs/);
});

test('Windows runtime recovery refuses to kill an unrelated port 4317 owner', () => {
  assert.match(source, /Get-NetTCPConnection -LocalPort 4317/);
  assert.match(source, /refusing to terminate it/i);
  assert.match(source, /ChatSentinel\|local-watchdog/);
});

test('Windows runtime recovery verifies health after supervisor restart', () => {
  assert.match(source, /run-watchdog\.ps1/);
  assert.match(source, /Invoke-RestMethod 'http:\/\/127\.0\.0\.1:4317\/health'/);
  assert.match(source, /runtime recovery did not restore \/health/i);
});
