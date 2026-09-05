#!/usr/bin/env bash
set -euo pipefail
LABEL="com.chatsentinel.watchdog"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
launchctl bootout "gui/$UID/$LABEL" 2>/dev/null || true
rm -f "$PLIST"
echo "ChatSentinel launchd service removed: $LABEL"
