$ErrorActionPreference = 'Continue'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

while ($true) {
  $started = Get-Date
  Write-Host "[ChatSentinel] starting watchdog at $started"
  node src/local-watchdog.js
  $code = $LASTEXITCODE
  $ended = Get-Date
  Write-Warning "[ChatSentinel] watchdog exited code=$code at $ended"
  Start-Sleep -Seconds 5
}
