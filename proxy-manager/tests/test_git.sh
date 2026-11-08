#!/bin/bash
# Git: global http.proxy and https.proxy.
source "$(dirname "$0")/lib.sh"
echo "== git =="
setup_env
use_integrations git

pm enable >/dev/null
expect "git http.proxy is set"  "$GATEWAY_URL" git config --global --get http.proxy
expect "git https.proxy is set" "$GATEWAY_URL" git config --global --get https.proxy
pm disable --no-check >/dev/null
check_fails "git http.proxy removed on disable"  git config --global --get http.proxy
check_fails "git https.proxy removed on disable" git config --global --get https.proxy

teardown_env
report
