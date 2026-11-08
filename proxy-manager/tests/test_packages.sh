#!/bin/bash
# Command-line tools: curl, wget, pip and npm.
source "$(dirname "$0")/lib.sh"
echo "== curl, wget, pip, npm =="
setup_env
use_integrations curl wget pip npm

pm enable >/dev/null
check "curlrc has the proxy"          grep -q "proxy = \"$GATEWAY_URL\"" "$HOME/.curlrc"
check "wgetrc turns the proxy on"     grep -q 'use_proxy = on' "$HOME/.wgetrc"
check "wgetrc sets http_proxy"        grep -q "http_proxy = $GATEWAY_URL" "$HOME/.wgetrc"
if command -v pip >/dev/null 2>&1 || command -v pip3 >/dev/null 2>&1; then
    check "pip.conf has the proxy"    grep -q "^proxy = $GATEWAY_URL" "$HOME/.config/pip/pip.conf"
else
    skip "pip is not installed"
fi
if command -v npm >/dev/null 2>&1; then
    check "npm config has the proxy"  grep -q "proxy=$GATEWAY_URL" "$HOME/.npmrc"
else
    skip "npm is not installed"
fi
pm disable --no-check >/dev/null
check_fails "curlrc removed on disable"      test -f "$HOME/.curlrc"
check_fails "wgetrc removed on disable"      test -f "$HOME/.wgetrc"
if command -v pip >/dev/null 2>&1 || command -v pip3 >/dev/null 2>&1; then
    check_fails "pip proxy removed on disable" grep -q '^proxy' "$HOME/.config/pip/pip.conf"
fi

teardown_env
report
