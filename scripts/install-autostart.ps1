$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$runner = Join-Path $PSScriptRoot 'run-watchdog.ps1'
$taskName = 'ChatSentinelWatchdog'

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  throw 'Node.js is required but was not found in PATH.'
}
if (-not (Test-Path $runner)) {
  throw "Runner not found: $runner"
}

Set-Location $root
Write-Host '[ChatSentinel] validating installation...'
npm test
if ($LASTEXITCODE -ne 0) { throw 'Unit tests failed.' }
npm run check
if ($LASTEXITCODE -ne 0) { throw 'Syntax checks failed.' }

$quotedRunner = '"' + $runner + '"'
$taskCommand = "powershell.exe -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File $quotedRunner"

schtasks.exe /Create /F /SC ONLOGON /RL LIMITED /TN $taskName /TR $taskCommand | Out-Host
if ($LASTEXITCODE -ne 0) { throw 'Could not create the ChatSentinel scheduled task.' }

Write-Host "[ChatSentinel] autostart installed as $taskName"
Write-Host '[ChatSentinel] the supervisor will adopt the existing healthy instance or start a new one.'
