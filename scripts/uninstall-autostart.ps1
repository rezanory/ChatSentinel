$ErrorActionPreference = 'Continue'
$taskName = 'ChatSentinelWatchdog'
$startup = [Environment]::GetFolderPath('Startup')
$launcher = Join-Path $startup 'ChatSentinelWatchdog.vbs'

schtasks.exe /Delete /F /TN $taskName 2>$null | Out-Null
if (Test-Path $launcher) {
  Remove-Item -Force $launcher
  Write-Host "[ChatSentinel] removed Startup launcher: $launcher"
}
Write-Host '[ChatSentinel] autostart entries removed. A currently running watchdog is left untouched.'
