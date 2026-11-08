#!/bin/bash
# Chrome / Chromium: launchers routed through the wrapper, restored on disable.
source "$(dirname "$0")/lib.sh"
echo "== browser =="
setup_env
use_integrations browser
LAUNCHER="$HOME/.local/share/applications/google-chrome.desktop"

pm enable >/dev/null
check "wrapper script installed"           test -x "$HOME/.local/bin/proxy-browser"
check "per-browser symlink created"        test -L "$HOME/.local/bin/proxy-google-chrome"
check "launcher now calls the wrapper"     grep -q "^Exec=$HOME/.local/bin/proxy-google-chrome %U" "$LAUNCHER"
check "gateway file written"               grep -q "$GATEWAY_URL" "$HOME/.config/proxy-manager/state/gateway"
pm disable --no-check >/dev/null
check_fails "user launcher removed"        test -f "$LAUNCHER"
check_fails "wrapper symlink removed"      test -L "$HOME/.local/bin/proxy-google-chrome"

teardown_env
report
