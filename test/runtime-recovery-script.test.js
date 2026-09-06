import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('../scripts/recover-runtime.ps1', import.meta.url), 'utf8');
const installer = fs.readFileSync(new URL('../scripts/install-autostart.ps1', import.meta.url), 'utf8');
const protocol = fs.readFileSync(new URL('../scripts/register-recovery-protocol.ps1', import.meta.url), 'utf8');

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

test('per-user recovery protocol is bounded to one fixed script and accepts no URL command input', () => {
  assert.match(protocol, /HKCU:\\Software\\Classes\\\$protocol/);
  assert.match(protocol, /URL Protocol/);
  assert.match(protocol, /recover-runtime\.ps1/);
  assert.match(protocol, /shell\\open\\command/);
  assert.doesNotMatch(protocol, /%1/);
  assert.doesNotMatch(protocol, /Invoke-Expression|iex\b/i);
});

test('autostart and manual recovery both refresh the per-user recovery protocol', () => {
  assert.match(installer, /register-recovery-protocol\.ps1/);
  assert.match(source, /register-recovery-protocol\.ps1/);
  assert.match(installer, /recovery protocol registration failed/i);
  assert.match(source, /recovery protocol registration failed/i);
});
