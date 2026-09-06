$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$runner = Join-Path $PSScriptRoot 'run-watchdog.ps1'
$taskName = 'ChatSentinelWatchdog'
if (-not (Test-Path $runner)) { throw "Runner not found: $runner" }

function Get-ChatSentinelHealth {
  try {
    return Invoke-RestMethod 'http://127.0.0.1:4317/health' -TimeoutSec 2
  } catch { return $null }
}

function Ensure-Persistence {
  $task = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
  if ($task) { return @{ mode = 'scheduled-task'; installed = $true } }

  $quotedRunner = '"' + $runner + '"'
  $taskCommand = "powershell.exe -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File $quotedRunner"
  $previous = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  & schtasks.exe /Create /F /SC ONLOGON /RL LIMITED /TN $taskName /TR $taskCommand *> $null
  $exit = $LASTEXITCODE
  $ErrorActionPreference = $previous
  if ($exit -eq 0) { return @{ mode = 'scheduled-task'; installed = $true } }

  $startup = [Environment]::GetFolderPath('Startup')
  $launcher = Join-Path $startup 'ChatSentinelWatchdog.vbs'
  $escaped = $runner.Replace('"','""')
  $vbs = 'Set sh = CreateObject("WScript.Shell")' + "`r`n" +
    'sh.Run "powershell.exe -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File ""' + $escaped + '""", 0, False'
  Set-Content -Path $launcher -Value $vbs -Encoding ASCII
  return @{ mode = 'startup-fallback'; installed = (Test-Path $launcher) }
}

Set-Location $root
$before = Get-ChatSentinelHealth
$persistence = Ensure-Persistence
if (-not $persistence.installed) { throw 'Unable to install a ChatSentinel persistence mechanism.' }

if ($before -and $before.ok) {
  Write-Host "[ChatSentinel] already healthy v$($before.version) pid=$($before.pid); persistence=$($persistence.mode)"
  exit 0
}

$listener = Get-NetTCPConnection -LocalPort 4317 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
if ($listener) {
  $process = Get-CimInstance Win32_Process -Filter "ProcessId=$($listener.OwningProcess)" -ErrorAction SilentlyContinue
  $command = [string]$process.CommandLine
  if ($command -notmatch '(?i)ChatSentinel|local-watchdog\.js') {
    throw "Port 4317 is owned by an unrelated process PID $($listener.OwningProcess); refusing to terminate it."
  }
  Stop-Process -Id $listener.OwningProcess -Force -ErrorAction SilentlyContinue
  Start-Sleep -Milliseconds 750
}

$supervisors = @(Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" -ErrorAction SilentlyContinue | Where-Object {
  $_.ProcessId -ne $PID -and $_.CommandLine -match '(?i)ChatSentinel' -and $_.CommandLine -match '(?i)run-watchdog\.ps1'
})
foreach ($supervisor in $supervisors) {
  Stop-Process -Id $supervisor.ProcessId -Force -ErrorAction SilentlyContinue
}

Start-Process -WindowStyle Hidden powershell.exe -ArgumentList '-NoProfile','-WindowStyle','Hidden','-ExecutionPolicy','Bypass','-File',"`"$runner`""

$health = $null
for ($i = 0; $i -lt 30; $i++) {
  Start-Sleep -Milliseconds 500
  $health = Get-ChatSentinelHealth
  if ($health -and $health.ok) { break }
}
if (-not $health -or -not $health.ok) { throw 'ChatSentinel runtime recovery did not restore /health.' }

Write-Host "[ChatSentinel] recovered v$($health.version) pid=$($health.pid); persistence=$($persistence.mode)"
