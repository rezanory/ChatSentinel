import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
export const RDC_TASK_NAME = 'DesktopCommander.RemoteAgent';
export const RDC_TASK_PATH = '\\';

const STATUS_SCRIPT = String.raw`
$ErrorActionPreference='Stop'
$task=Get-ScheduledTask -TaskName 'DesktopCommander.RemoteAgent' -TaskPath '\' -ErrorAction SilentlyContinue
if(-not $task){
  [pscustomobject]@{ok=$true;supported=$true;installed=$false;validated=$false;running=$false;state='Missing';processCount=0;taskName='DesktopCommander.RemoteAgent';taskPath='\'} | ConvertTo-Json -Compress
  exit 0
}
$action=$task.Actions | Select-Object -First 1
$actionArgs=[string]$action.Arguments
$exe=[string]$action.Execute
$validated=($exe -match '(?i)(^|[\\/])node\.exe$') -and ($actionArgs -match '@wonderwhy-er[\\/]desktop-commander[\\/]dist[\\/]index\.js') -and ($actionArgs -match '(^|\s)remote(\s|$)')
$processCount=@(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object {
  ([string]$_.Name -ieq 'node.exe') -and ([string]$_.ExecutablePath -ieq $exe) -and
  ([string]$_.CommandLine -match '@wonderwhy-er[\\/]desktop-commander[\\/]dist[\\/]index\.js') -and
  ([string]$_.CommandLine -match '(^|\s)remote(\s|$)')
}).Count
$running=$validated -and ($task.State -eq 'Running') -and ($processCount -gt 0)
[pscustomobject]@{ok=$validated;supported=$true;installed=$true;validated=$validated;running=$running;state=[string]$task.State;processCount=$processCount;taskName='DesktopCommander.RemoteAgent';taskPath='\'} | ConvertTo-Json -Compress
`;

const RECOVER_SCRIPT = String.raw`
$ErrorActionPreference='Stop'
$task=Get-ScheduledTask -TaskName 'DesktopCommander.RemoteAgent' -TaskPath '\' -ErrorAction Stop
$action=$task.Actions | Select-Object -First 1
$actionArgs=[string]$action.Arguments
$exe=[string]$action.Execute
$validated=($exe -match '(?i)(^|[\\/])node\.exe$') -and ($actionArgs -match '@wonderwhy-er[\\/]desktop-commander[\\/]dist[\\/]index\.js') -and ($actionArgs -match '(^|\s)remote(\s|$)')
if(-not $validated){ throw 'remote-desktop-commander-task-validation-failed' }
Stop-ScheduledTask -TaskName 'DesktopCommander.RemoteAgent' -TaskPath '\' -ErrorAction SilentlyContinue
Start-Sleep -Milliseconds 400
Start-ScheduledTask -TaskName 'DesktopCommander.RemoteAgent' -TaskPath '\' -ErrorAction Stop
$running=$false
$processCount=0
$state='Unknown'
for($i=0;$i -lt 20;$i++){
  Start-Sleep -Milliseconds 250
  $task=Get-ScheduledTask -TaskName 'DesktopCommander.RemoteAgent' -TaskPath '\' -ErrorAction Stop
  $state=[string]$task.State
  $processCount=@(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object {
    ([string]$_.Name -ieq 'node.exe') -and ([string]$_.ExecutablePath -ieq $exe) -and
    ([string]$_.CommandLine -match '@wonderwhy-er[\\/]desktop-commander[\\/]dist[\\/]index\.js') -and
    ([string]$_.CommandLine -match '(^|\s)remote(\s|$)')
  }).Count
  if(($state -eq 'Running') -and ($processCount -gt 0)){ $running=$true; break }
}
[pscustomobject]@{ok=$running;supported=$true;installed=$true;validated=$true;running=$running;state=$state;processCount=$processCount;restarted=$true;taskName='DesktopCommander.RemoteAgent';taskPath='\'} | ConvertTo-Json -Compress
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
    return { ...result, recovered: Boolean(result?.ok && result?.running), taskName: RDC_TASK_NAME, taskPath: RDC_TASK_PATH };
  } catch (error) {
    return { ...status, ok: false, recovered: false, error: String(error?.message || error), taskName: RDC_TASK_NAME, taskPath: RDC_TASK_PATH };
  }
}
