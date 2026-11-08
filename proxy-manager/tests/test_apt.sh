#!/bin/bash
# APT: proxy written through the root helper (stubbed here, no password needed).
source "$(dirname "$0")/lib.sh"
echo "== apt =="
setup_env
use_integrations apt

pm enable >/dev/null
check "apt proxy written"                  grep -q "$GATEWAY_URL" "$HOME/apt-proxy.conf"
check "apt marker file created"            test -f "$HOME/.config/proxy-manager/state/apt-proxy"
pm disable --no-check >/dev/null
check_fails "apt proxy removed"            test -f "$HOME/apt-proxy.conf"

teardown_env
report
