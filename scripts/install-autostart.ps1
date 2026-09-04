$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$runner = Join-Path $PSScriptRoot 'run-watchdog.ps1'
$taskName = 'ChatSentinelWatchdog'
$dataRoot = if ($env:CHATSENTINEL_DATA_DIR) { $env:CHATSENTINEL_DATA_DIR } else { Join-Path $env:LOCALAPPDATA 'ChatSentinel' }

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  throw 'Node.js is required but was not found in PATH.'
}
if (-not (Test-Path $runner)) { throw "Runner not found: $runner" }

New-Item -ItemType Directory -Force -Path $dataRoot | Out-Null
Set-Location $root
Write-Host '[ChatSentinel] running full production validation...'
npm run validate
if ($LASTEXITCODE -ne 0) { throw 'Production validation failed.' }

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

Start-Process -WindowStyle Hidden powershell.exe -ArgumentList '-NoProfile','-WindowStyle','Hidden','-ExecutionPolicy','Bypass','-File',"`"$runner`""
$healthy = $false
for ($i = 0; $i -lt 20; $i++) {
  Start-Sleep -Milliseconds 500
  try {
    $health = Invoke-RestMethod 'http://127.0.0.1:4317/health' -TimeoutSec 2
    if ($health.ok -and $health.version -eq '1.0.0') { $healthy = $true; break }
  } catch {}
}
if (-not $healthy) { throw 'ChatSentinel supervisor started but v1.0.0 health check did not pass.' }

Write-Host "[ChatSentinel] production watchdog healthy. Data: $dataRoot"
Write-Host '[ChatSentinel] Chrome extension folder: C:\ChatSentinel\extension'
