$ErrorActionPreference = 'Stop'
$Repo = 'https://github.com/rezanory/ChatSentinel.git'
$Root = 'C:\ChatSentinel'

if (-not (Test-Path $Root)) {
  New-Item -ItemType Directory -Path $Root | Out-Null
}

if (-not (Test-Path (Join-Path $Root '.git'))) {
  if ((Get-ChildItem -Force $Root | Measure-Object).Count -eq 0) {
    git clone $Repo $Root
  } else {
    Set-Location $Root
    git init
    git remote add origin $Repo
    git fetch origin main
    git checkout -B main origin/main
  }
} else {
  Set-Location $Root
  git fetch origin main
  git checkout main
  git pull --ff-only origin main
}

Set-Location $Root
node --version
npm test
npm run check
Write-Host 'ChatSentinel local baseline is ready.'
