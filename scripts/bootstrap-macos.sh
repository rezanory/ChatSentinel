#!/usr/bin/env bash
set -euo pipefail
APPLY=0
INSTALL_HOMEBREW=0
SERVICE=0
for arg in "$@"; do
  case "$arg" in
    --apply) APPLY=1 ;;
    --install-homebrew) INSTALL_HOMEBREW=1 ;;
    --service) SERVICE=1 ;;
  esac
done
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
missing=()
command -v node >/dev/null 2>&1 || missing+=(node)
command -v git >/dev/null 2>&1 || missing+=(git)
command -v gh >/dev/null 2>&1 || missing+=(gh)
[[ -x "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" ]] || missing+=(chrome)
echo "ChatSentinel macOS bootstrap"
echo "Missing: ${missing[*]:-none}"
if (( ${#missing[@]} > 0 )) && ! command -v brew >/dev/null 2>&1; then
  echo "Homebrew is not installed."
  if (( ! APPLY )); then
    echo "Plan only: automatic installation requires Homebrew. Use --apply --install-homebrew or install prerequisites manually."
    exit 0
  fi
  if (( INSTALL_HOMEBREW )); then
    /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
    eval "$(/opt/homebrew/bin/brew shellenv 2>/dev/null || /usr/local/bin/brew shellenv)"
  else
    echo "Apply blocked: re-run with --apply --install-homebrew or install prerequisites manually."
    exit 2
  fi
fi
if (( ${#missing[@]} > 0 )); then
  if (( ! APPLY )); then
    echo "Plan only. Re-run with --apply to install missing prerequisites."
    exit 0
  fi
  for item in "${missing[@]}"; do
    case "$item" in
      node) brew install node ;;
      git) brew install git ;;
      gh) brew install gh ;;
      chrome) brew install --cask google-chrome ;;
    esac
  done
fi
cd "$ROOT"
if [[ -f package.json ]]; then npm install --ignore-scripts --no-audit --no-fund; fi
if (( SERVICE )); then bash "$ROOT/scripts/install-autostart-macos.sh"; fi
echo "ChatSentinel macOS bootstrap complete."
echo "Next: load $ROOT/extension from chrome://extensions in Developer mode."
