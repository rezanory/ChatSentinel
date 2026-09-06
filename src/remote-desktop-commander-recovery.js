import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
export const RDC_TASK_NAME = 'DesktopCommander.RemoteAgent';

const STATUS_SCRIPT = String.raw`
$ErrorActionPreference='Stop'
$task=Get-ScheduledTask -TaskName 'DesktopCommander.RemoteAgent' -ErrorAction SilentlyContinue
if(-not $task){
  [pscustomobject]@{ok=$true;supported=$true;installed=$false;validated=$false;running=$false;state='Missing';processCount=0} | ConvertTo-Json -Compress
  exit 0
}
$action=$task.Actions | Select-Object -First 1
$args=[string]$action.Arguments
$exe=[string]$action.Execute
$validated=($exe -match '(?i)(^|[\\/])node\.exe$') -and ($args -match '@wonderwhy-er[\\/]desktop-commander[\\/]dist[\\/]index\.js') -and ($args -match '(^|\s)remote(\s|$)')
$processCount=@(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object { ([string]$_.CommandLine -match '@wonderwhy-er[\\/]desktop-commander') -and ([string]$_.CommandLine -match '(^|\s)remote(\s|$)') }).Count
[pscustomobject]@{ok=$validated;supported=$true;installed=$true;validated=$validated;running=(($task.State -eq 'Running') -or ($processCount -gt 0));state=[string]$task.State;processCount=$processCount} | ConvertTo-Json -Compress
`;

const RECOVER_SCRIPT = String.raw`
$ErrorActionPreference='Stop'
$task=Get-ScheduledTask -TaskName 'DesktopCommander.RemoteAgent' -ErrorAction Stop
$action=$task.Actions | Select-Object -First 1
$args=[string]$action.Arguments
$exe=[string]$action.Execute
$validated=($exe -match '(?i)(^|[\\/])node\.exe$') -and ($args -match '@wonderwhy-er[\\/]desktop-commander[\\/]dist[\\/]index\.js') -and ($args -match '(^|\s)remote(\s|$)')
if(-not $validated){ throw 'remote-desktop-commander-task-validation-failed' }
Stop-ScheduledTask -TaskName 'DesktopCommander.RemoteAgent' -ErrorAction SilentlyContinue
Start-Sleep -Milliseconds 400
Start-ScheduledTask -TaskName 'DesktopCommander.RemoteAgent' -ErrorAction Stop
Start-Sleep -Milliseconds 900
$task=Get-ScheduledTask -TaskName 'DesktopCommander.RemoteAgent' -ErrorAction Stop
$processCount=@(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object { ([string]$_.CommandLine -match '@wonderwhy-er[\\/]desktop-commander') -and ([string]$_.CommandLine -match '(^|\s)remote(\s|$)') }).Count
$running=(($task.State -eq 'Running') -or ($processCount -gt 0))
[pscustomobject]@{ok=$running;supported=$true;installed=$true;validated=$true;running=$running;state=[string]$task.State;processCount=$processCount;restarted=$true} | ConvertTo-Json -Compress
`;

async function runPowerShell(script) {
  const { stdout } = await execFileAsync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script], {
    windowsHide: true,
    timeout: 10000,
    encoding: 'utf8'
  });
  const line = String(stdout || '').trim().split(/\r?\n/).filter(Boolean).at(-1);
  if (!line) throw new Error('remote-desktop-commander-empty-response');
  return JSON.parse(line);
}

export async function remoteDesktopCommanderStatus(options = {}) {
  const platform = options.platform || process.platform;
  if (platform !== 'win32') return { ok: true, supported: false, installed: false, validated: false, running: false, state: 'Unsupported' };
  try {
    return await (options.run || runPowerShell)(STATUS_SCRIPT);
  } catch (error) {
    return { ok: false, supported: true, installed: false, validated: false, running: false, error: String(error?.message || error) };
  }
}

export async function recoverRemoteDesktopCommander(options = {}) {
  const status = await remoteDesktopCommanderStatus(options);
  if (!status.supported) return { ...status, recovered: false, error: 'remote-desktop-commander-unsupported' };
  if (!status.installed) return { ...status, recovered: false, error: 'remote-desktop-commander-task-missing' };
  if (!status.validated) return { ...status, recovered: false, error: 'remote-desktop-commander-task-untrusted' };
  try {
    const result = await (options.run || runPowerShell)(RECOVER_SCRIPT);
    return { ...result, recovered: Boolean(result?.ok && result?.running), taskName: RDC_TASK_NAME };
  } catch (error) {
    return { ...status, ok: false, recovered: false, error: String(error?.message || error), taskName: RDC_TASK_NAME };
  }
}
