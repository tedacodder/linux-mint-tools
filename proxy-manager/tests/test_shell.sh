#!/bin/bash
# Shell environment: environment.d file and the top of ~/.bashrc.
source "$(dirname "$0")/lib.sh"
echo "== shell environment =="
setup_env
use_integrations env

bashrc_once()   { [[ $(grep -c '^# PROXY_SETTINGS$' "$HOME/.bashrc") -eq 1 ]]; }
bashrc_first()  { head -1 "$HOME/.bashrc" | grep -q '^# PROXY_SETTINGS$'; }

pm enable >/dev/null
check "environment.d file written"              test -f "$HOME/.config/environment.d/proxy.conf"
check "environment.d sets http_proxy"           grep -q "http_proxy=$GATEWAY_URL" "$HOME/.config/environment.d/proxy.conf"
check "bashrc block is the first thing in file" bashrc_first
check "bashrc block exports the proxy"          grep -q "export http_proxy=\"$GATEWAY_URL\"" "$HOME/.bashrc"
check "bashrc block appears only once"          bashrc_once
pm enable >/dev/null
check "enabling twice still gives one block"    bashrc_once
pm disable --no-check >/dev/null
check_fails "environment.d file removed on disable" test -f "$HOME/.config/environment.d/proxy.conf"
check "bashrc block now unsets the variables"   grep -q 'unset http_proxy' "$HOME/.bashrc"

teardown_env
report
