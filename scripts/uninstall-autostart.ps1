$ErrorActionPreference = 'Continue'
$taskName = 'ChatSentinelWatchdog'

schtasks.exe /Delete /F /TN $taskName | Out-Host
if ($LASTEXITCODE -eq 0) {
  Write-Host "[ChatSentinel] removed scheduled task $taskName"
} else {
  Write-Warning "[ChatSentinel] scheduled task $taskName was not removed (it may not exist)."
}
