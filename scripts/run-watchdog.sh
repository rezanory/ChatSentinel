#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DATA_ROOT="${CHATSENTINEL_DATA_DIR:-$HOME/Library/Application Support/ChatSentinel}"
mkdir -p "$DATA_ROOT/logs"
export CHATSENTINEL_DATA_DIR="$DATA_ROOT"
cd "$ROOT"
exec node src/local-watchdog.js >>"$DATA_ROOT/logs/watchdog.stdout.log" 2>>"$DATA_ROOT/logs/watchdog.stderr.log"
