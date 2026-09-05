param(
  [switch]$Apply,
  [switch]$Service
)
$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot
$missing = @()
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { $missing += 'node' }
if (-not (Get-Command git -ErrorAction SilentlyContinue)) { $missing += 'git' }
if (-not (Get-Command gh -ErrorAction SilentlyContinue)) { $missing += 'gh' }
$chromeCandidates = @(
  "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
  "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
  "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe"
) | Where-Object { $_ -and (Test-Path $_) }
if (-not $chromeCandidates) { $missing += 'chrome' }
Write-Host 'ChatSentinel Windows bootstrap'
Write-Host ('Missing: ' + $(if ($missing.Count) { $missing -join ', ' } else { 'none' }))
if ($missing.Count -and -not $Apply) {
  if (-not (Get-Command winget -ErrorAction SilentlyContinue)) {
    Write-Host 'Plan only: winget/App Installer is not detected, so automatic installation is unavailable until it is installed.'
  }
  Write-Host 'Plan only. Re-run with -Apply to install missing prerequisites.'
  exit 0
}
if ($missing.Count -and -not (Get-Command winget -ErrorAction SilentlyContinue)) {
  throw 'Apply blocked: winget is required for automatic prerequisite installation. Install prerequisites manually or install App Installer.'
}
$packages = @{
  node = 'OpenJS.NodeJS.LTS'
  git = 'Git.Git'
  gh = 'GitHub.cli'
  chrome = 'Google.Chrome'
}
foreach ($item in $missing) {
  $id = $packages[$item]
  if (-not $id) { continue }
  & winget install --id $id --exact --accept-source-agreements --accept-package-agreements
  if ($LASTEXITCODE -ne 0) { throw "Failed to install $item via winget" }
}
Set-Location $Root
if (Test-Path package.json) {
  npm install --ignore-scripts --no-audit --no-fund
}
if ($Service) {
  & (Join-Path $PSScriptRoot 'install-autostart.ps1')
}
Write-Host 'ChatSentinel Windows bootstrap complete.'
Write-Host "Next: load $Root\extension from chrome://extensions in Developer mode."
