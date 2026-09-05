#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LABEL="com.chatsentinel.watchdog"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
mkdir -p "$HOME/Library/LaunchAgents"
NODE_BIN="$(command -v node || true)"
if [[ -z "$NODE_BIN" ]]; then
  echo "Node.js is required. Run: bash scripts/bootstrap-macos.sh --apply" >&2
  exit 1
fi
DATA_ROOT="${CHATSENTINEL_DATA_DIR:-$HOME/Library/Application Support/ChatSentinel}"
mkdir -p "$DATA_ROOT/logs"
cat >"$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>$LABEL</string>
<key>ProgramArguments</key><array><string>$NODE_BIN</string><string>$ROOT/src/local-watchdog.js</string></array>
<key>WorkingDirectory</key><string>$ROOT</string>
<key>EnvironmentVariables</key><dict><key>CHATSENTINEL_DATA_DIR</key><string>$DATA_ROOT</string></dict>
<key>RunAtLoad</key><true/><key>KeepAlive</key><true/>
<key>StandardOutPath</key><string>$DATA_ROOT/logs/watchdog.stdout.log</string>
<key>StandardErrorPath</key><string>$DATA_ROOT/logs/watchdog.stderr.log</string>
</dict></plist>
EOF
launchctl bootout "gui/$UID/$LABEL" 2>/dev/null || true
launchctl bootstrap "gui/$UID" "$PLIST"
launchctl enable "gui/$UID/$LABEL"
launchctl kickstart -k "gui/$UID/$LABEL"
echo "ChatSentinel launchd service installed: $LABEL"
echo "Health: http://127.0.0.1:4317/health"
