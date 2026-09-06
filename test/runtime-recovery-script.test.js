import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('../scripts/recover-runtime.ps1', import.meta.url), 'utf8');

test('Windows runtime recovery refreshes persistence before restart', () => {
  assert.match(source, /ChatSentinelWatchdog/);
  assert.match(source, /schtasks\.exe \/Create/);
  assert.match(source, /ChatSentinelWatchdog\.vbs/);
});

test('Windows runtime recovery fails closed for an unrelated port 4317 owner', () => {
  assert.match(source, /Get-NetTCPConnection -LocalPort 4317/);
  assert.match(source, /refusing recovery/i);
  assert.match(source, /ChatSentinel\|local-watchdog/);
  assert.doesNotMatch(source, /Stop-Process/);
});

test('Windows runtime recovery verifies health after supervisor restart', () => {
  assert.match(source, /run-watchdog\.ps1/);
  assert.match(source, /named mutex/i);
  assert.match(source, /Invoke-RestMethod 'http:\/\/127\.0\.0\.1:4317\/health'/);
  assert.match(source, /runtime recovery did not restore \/health/i);
});
