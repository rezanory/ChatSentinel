$ErrorActionPreference = 'Continue'
$root = Split-Path -Parent $PSScriptRoot
$logDir = Join-Path $root 'logs'
$logFile = Join-Path $logDir 'watchdog.log'
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
Set-Location $root

function Write-Log($message) {
  $line = "$(Get-Date -Format o) $message"
  Add-Content -Path $logFile -Value $line -Encoding UTF8
}

function Test-Healthy {
  try {
    $h = Invoke-RestMethod 'http://127.0.0.1:4317/health' -TimeoutSec 2
    return [bool]$h.ok
  } catch { return $false }
}

while ($true) {
  if (Test-Healthy) {
    Start-Sleep -Seconds 10
    continue
  }

  if ((Test-Path $logFile) -and (Get-Item $logFile).Length -gt 5MB) {
    Move-Item -Force $logFile "$logFile.1"
  }

  Write-Log '[ChatSentinel] watchdog process starting'
  node src/local-watchdog.js *>> $logFile
  Write-Log "[ChatSentinel] watchdog exited code=$LASTEXITCODE; restart in 3s"
  Start-Sleep -Seconds 3
}
