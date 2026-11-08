#!/bin/bash
# Gateway watcher: runs while enabled and stops on disable.
source "$(dirname "$0")/lib.sh"
echo "== gateway watcher =="
setup_env
use_integrations env
PIDFILE="$HOME/.config/proxy-manager/state/gateway-watcher.pid"

pm enable >/dev/null
sleep 1
check "watcher pid file created"           test -f "$PIDFILE"
check "watcher process is running"         bash -c "kill -0 \$(cat '$PIDFILE')"
pm disable --no-check >/dev/null
sleep 1
check_fails "watcher stopped on disable"   bash -c "kill -0 \$(cat '$PIDFILE' 2>/dev/null) 2>/dev/null"

teardown_env
report
