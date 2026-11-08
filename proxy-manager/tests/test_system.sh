#!/bin/bash
# System settings: GNOME/Cinnamon manual proxy through gsettings (stubbed here).
source "$(dirname "$0")/lib.sh"
echo "== system settings =="
setup_env
use_integrations system

pm enable >/dev/null
check "system proxy mode is manual"        grep -q "'manual'" "$HOME/gsettings.mode"
check "system http host set"               grep -q 'proxy.http host 192.168.137.1' "$HOME/gsettings.log"
check "system https port set"              grep -q 'proxy.https port 8080' "$HOME/gsettings.log"
pm disable --no-check >/dev/null
check "system proxy mode back to none"     grep -q "'none'" "$HOME/gsettings.mode"

teardown_env
report
