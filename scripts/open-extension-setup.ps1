$extensionPath = (Resolve-Path (Join-Path $PSScriptRoot '..\extension')).Path
Set-Clipboard -Value $extensionPath
Write-Host "[ChatSentinel] Extension path copied to clipboard: $extensionPath"
Write-Host '[ChatSentinel] In Chrome: enable Developer mode, click Load unpacked, paste the copied path.'
Start-Process explorer.exe $extensionPath
Start-Process 'chrome.exe' 'chrome://extensions/'
