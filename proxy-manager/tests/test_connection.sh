#!/bin/bash
# Test connection: reports an error when nothing answers through the proxy.
source "$(dirname "$0")/lib.sh"
echo "== test connection =="
setup_env
use_integrations env
pm set-gateway 127.0.0.1 9 >/dev/null     # port 9 is closed, so nothing answers

check_fails "test fails when proxy is unreachable" pm test
check "test reports an error message"             bash -c "'$PM' test </dev/null 2>/dev/null | jq -e 'has(\"error\")' >/dev/null"

teardown_env
report
