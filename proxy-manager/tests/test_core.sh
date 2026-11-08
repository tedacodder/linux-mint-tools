#!/bin/bash
# Core: status output and input validation.
source "$(dirname "$0")/lib.sh"
echo "== core =="
setup_env
use_integrations git

check "status prints valid JSON"                status_is '.'
check "proxy starts disabled"                   status_is '.enabled == false'
check "status reports the new integrations"     status_is '.active | has("wget") and has("docker") and has("firefox") and has("system")'
check_fails "unknown command fails"             pm frobnicate
check_fails "rejects a gateway with spaces"     pm set-gateway "bad host" 8080
check_fails "rejects port 0"                    pm set-gateway 192.168.1.1 0
check_fails "rejects port 70000"                pm set-gateway 192.168.1.1 70000
check_fails "rejects an unknown integration"    pm set-integration nope on
check_fails "rejects a bad on/off value"        pm set-integration git maybe

teardown_env
report
