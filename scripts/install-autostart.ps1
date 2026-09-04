$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$runner = Join-Path $PSScriptRoot 'run-watchdog.ps1'
$taskName = 'ChatSentinelWatchdog'

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  throw 'Node.js is required but was not found in PATH.'
}
if (-not (Test-Path $runner)) { throw "Runner not found: $runner" }

Set-Location $root
Write-Host '[ChatSentinel] validating installation...'
npm test
if ($LASTEXITCODE -ne 0) { throw 'Unit tests failed.' }
npm run check
if ($LASTEXITCODE -ne 0) { throw 'Syntax checks failed.' }

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
Write-Host '[ChatSentinel] supervisor started. Named mutex prevents duplicate supervisors.'
