$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$runner = Join-Path $PSScriptRoot 'run-watchdog.ps1'
$taskName = 'ChatSentinelWatchdog'
$dataRoot = if ($env:CHATSENTINEL_DATA_DIR) { $env:CHATSENTINEL_DATA_DIR } else { Join-Path $env:LOCALAPPDATA 'ChatSentinel' }
$targetVersion = '1.3.4'

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  throw 'Node.js is required but was not found in PATH.'
}
if (-not (Test-Path $runner)) { throw "Runner not found: $runner" }

New-Item -ItemType Directory -Force -Path $dataRoot | Out-Null
Set-Location $root
Write-Host '[ChatSentinel] running production release validation...'
npm run release-validate
if ($LASTEXITCODE -ne 0) { throw 'Production release validation failed.' }

$quotedRunner = '"' + $runner + '"'
$taskCommand = "powershell.exe -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File $quotedRunner"
$scheduled = $false
$previousPreference = $ErrorActionPreference
$ErrorActionPreference = 'Continue'
& schtasks.exe /Create /F /SC ONLOGON /RL LIMITED /TN $taskName /TR $taskCommand *> $null
$taskExit = $LASTEXITCODE
$ErrorActionPreference = $previousPreference

if ($taskExit -eq 0) {
  $scheduled = $true
  Write-Host "[ChatSentinel] autostart installed as Scheduled Task: $taskName"
}

if (-not $scheduled) {
  $startup = [Environment]::GetFolderPath('Startup')
  $launcher = Join-Path $startup 'ChatSentinelWatchdog.vbs'
  $escaped = $runner.Replace('"','""')
  $vbs = 'Set sh = CreateObject("WScript.Shell")' + "`r`n" +
    'sh.Run "powershell.exe -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File ""' + $escaped + '""", 0, False'
  Set-Content -Path $launcher -Value $vbs -Encoding ASCII
  Write-Host "[ChatSentinel] Scheduled Task unavailable; Startup launcher installed: $launcher"
}
# Upgrade-aware supervisor handoff: retire supervisors rooted at an older installation.
$currentRunner = [IO.Path]::GetFullPath($runner)
$supervisors = @(Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" -ErrorAction SilentlyContinue | Where-Object {
  $_.ProcessId -ne $PID -and $_.CommandLine -match '(?i)ChatSentinel' -and $_.CommandLine -match '(?i)run-watchdog\.ps1'
})
foreach ($supervisor in $supervisors) {
  $match = [regex]::Match([string]$supervisor.CommandLine, '(?i)-File\s+(?:"([^"]*run-watchdog\.ps1)"|([^\s]*run-watchdog\.ps1))')
  if (-not $match.Success) { continue }
  $supervisorRunner = if ($match.Groups[1].Success) { $match.Groups[1].Value } else { $match.Groups[2].Value }
  try { $supervisorRunner = [IO.Path]::GetFullPath($supervisorRunner) } catch { continue }
  if (-not [string]::Equals($supervisorRunner, $currentRunner, [StringComparison]::OrdinalIgnoreCase)) {
    Write-Host "[ChatSentinel] retiring stale supervisor PID $($supervisor.ProcessId): $supervisorRunner"
    Stop-Process -Id $supervisor.ProcessId -Force -ErrorAction SilentlyContinue
  }
}

# Upgrade-aware recycle: once stale supervisors are retired, stop the old listener.
# A supervisor already rooted at this installation may restart it; otherwise a new one is started below.
try {
  $currentHealth = Invoke-RestMethod 'http://127.0.0.1:4317/health' -TimeoutSec 2
  if ($currentHealth.ok -and $currentHealth.version -ne $targetVersion) {
    $listener = Get-NetTCPConnection -LocalPort 4317 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($listener) {
      Write-Host "[ChatSentinel] upgrading listener from v$($currentHealth.version) to v$targetVersion (PID $($listener.OwningProcess))"
      Stop-Process -Id $listener.OwningProcess -Force
      Start-Sleep -Seconds 1
    }
  }
} catch {}

# Safe even when a supervisor already exists: the named mutex makes duplicates exit.
Start-Process -WindowStyle Hidden powershell.exe -ArgumentList '-NoProfile','-WindowStyle','Hidden','-ExecutionPolicy','Bypass','-File',"`"$runner`""

$healthy = $false
for ($i = 0; $i -lt 30; $i++) {
  Start-Sleep -Milliseconds 500
  try {
    $health = Invoke-RestMethod 'http://127.0.0.1:4317/health' -TimeoutSec 2
    if ($health.ok -and $health.version -eq $targetVersion) { $healthy = $true; break }
  } catch {}
}
if (-not $healthy) {
  throw "ChatSentinel supervisor started but v$targetVersion health check did not pass."
}

Write-Host "[ChatSentinel] production watchdog v$targetVersion healthy. Data: $dataRoot"
Write-Host '[ChatSentinel] Chrome extension folder: C:\ChatSentinel\extension'
Write-Host '[ChatSentinel] Reload the unpacked extension once in chrome://extensions after an extension-code upgrade.'
