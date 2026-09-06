$ErrorActionPreference = 'Stop'

$protocol = 'chatsentinel-recover'
$recover = Join-Path $PSScriptRoot 'recover-runtime.ps1'
if (-not (Test-Path -LiteralPath $recover -PathType Leaf)) {
  throw "Recovery script not found: $recover"
}

$powershellCommand = Get-Command powershell.exe -ErrorAction SilentlyContinue
if (-not $powershellCommand) {
  throw 'Windows PowerShell is required to register the ChatSentinel recovery protocol.'
}
$powershell = $powershellCommand.Source

$protocolRoot = "HKCU:\Software\Classes\$protocol"
$commandKey = Join-Path $protocolRoot 'shell\open\command'

# The protocol handler is intentionally non-parameterized. Any chatsentinel-recover://
# URL resolves to the single fixed recovery script; URL content is never forwarded to
# PowerShell or interpreted as a command.
$handlerCommand = '"' + $powershell + '" -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "' + $recover + '"'

New-Item -Path $protocolRoot -Force | Out-Null
Set-Item -Path $protocolRoot -Value 'URL:ChatSentinel Recovery Protocol'
New-ItemProperty -Path $protocolRoot -Name 'URL Protocol' -PropertyType String -Value '' -Force | Out-Null
New-Item -Path $commandKey -Force | Out-Null
Set-Item -Path $commandKey -Value $handlerCommand

$registered = (Get-Item -LiteralPath $commandKey -ErrorAction Stop).GetValue('')
if ($registered -ne $handlerCommand) {
  throw 'ChatSentinel recovery protocol registration verification failed.'
}

Write-Host "[ChatSentinel] recovery protocol registered for current user: $protocol://runtime"
Write-Host "[ChatSentinel] recovery handler: $recover"
