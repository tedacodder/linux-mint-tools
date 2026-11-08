#!/bin/bash
# Settings: gateway, auto-detect and integration switches (what the menu calls).
source "$(dirname "$0")/lib.sh"
echo "== settings =="
setup_env
use_integrations git

pm set-gateway 192.168.137.7 8081 >/dev/null
check "set-gateway stores the new address"   status_is '.httpProxy == "http://192.168.137.7:8081"'
check "set-gateway turns auto-detect off"    status_is '.gatewayAuto == false'
pm set-auto true >/dev/null
check "set-auto true turns auto-detect on"   status_is '.gatewayAuto == true'
pm set-auto false >/dev/null
check "set-auto false turns it off again"    status_is '.gatewayAuto == false'
pm set-integration docker on >/dev/null
check "set-integration on adds it"           status_is '.integrations | index("docker") != null'
pm set-integration docker off >/dev/null
check "set-integration off removes it"       status_is '.integrations | index("docker") == null'
pm enable >/dev/null
pm set-gateway 192.168.137.9 8082 >/dev/null
check "manual gateway survives a gateway-change"  bash -c "'$PM' gateway-change </dev/null | jq -e '.gatewayChanged == false' >/dev/null"
check "saving a gateway applies it while on"      status_is '.httpProxy == "http://192.168.137.9:8082"'
pm disable --no-check >/dev/null

teardown_env
report
