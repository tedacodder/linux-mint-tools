#!/bin/bash
# Safety: the proxy must never break the internet silently, and disable must
# only undo what Proxy Manager changed.
source "$(dirname "$0")/lib.sh"
echo "== safety ==" 
setup_env
use_integrations env

# Enable checks the gateway first
export FAKE_PROXY_OK=""                      # nothing answers anywhere
check_fails "enable refuses when no proxy answers" pm enable
check "refusal says why, in JSON" bash -c "'$PM' enable </dev/null 2>/dev/null | jq -e 'has(\"error\")' >/dev/null"
check_fails "refused enable writes no environment file" test -f "$HOME/.config/environment.d/proxy.conf"
status_is '.enabled == false' && ok "refused enable leaves the proxy off" || fail "refused enable leaves the proxy off"
check "enable --force applies anyway" bash -c "'$PM' enable --force </dev/null >/dev/null 2>&1 && test -f '$HOME/.config/environment.d/proxy.conf'"
unset FAKE_PROXY_OK
pm disable --no-check >/dev/null

# A gateway change to a machine that is not a proxy turns the proxy off
jq '.gatewayAuto = true' "$HOME/.config/proxy-manager/proxy.json" > "$HOME/p.json" && mv "$HOME/p.json" "$HOME/.config/proxy-manager/proxy.json"
export FAKE_GATEWAY=192.168.137.1
pm enable >/dev/null
export FAKE_GATEWAY=10.0.0.1                 # the network changed to one that is not a proxy
check "a new gateway that is not a proxy turns the proxy off" bash -c "'$PM' gateway-change </dev/null | jq -e '.proxyOff == true and .enabled == false' >/dev/null"
check_fails "environment file removed when the proxy turns off" test -f "$HOME/.config/environment.d/proxy.conf"
unset FAKE_GATEWAY

# Disable undoes what was applied, even if the settings list changed afterwards
use_integrations git
pm enable >/dev/null
jq '.integrations = []' "$HOME/.config/proxy-manager/proxy.json" > "$HOME/p.json" && mv "$HOME/p.json" "$HOME/.config/proxy-manager/proxy.json"
pm disable --no-check >/dev/null
check_fails "git proxy removed even after the settings list changed" git config --global --get http.proxy

# Your own proxy settings are not touched
use_integrations env
git config --global http.proxy "http://my-own-proxy:3128"
pm enable >/dev/null
pm disable --no-check >/dev/null
check "a git proxy you set yourself is kept" bash -c "git config --global --get http.proxy | grep -q my-own-proxy"
git config --global --unset-all http.proxy 2>/dev/null

use_integrations docker
mkdir -p "$HOME/.docker"
echo '{"proxies":{"default":{"httpProxy":"http://other:1","httpsProxy":"http://other:1","noProxy":""}}}' > "$HOME/.docker/config.json"
pm disable --no-check >/dev/null
check "a Docker proxy that is not ours is kept" bash -c "jq -e '.proxies.default.httpProxy == \"http://other:1\"' '$HOME/.docker/config.json' >/dev/null"

use_integrations system
echo "'manual'" > "$HOME/gsettings.mode"
echo "'10.9.9.9'" > "$HOME/gsettings.host"
pm disable --no-check >/dev/null
check "a system proxy pointing elsewhere is left alone" bash -c "grep -q manual '$HOME/gsettings.mode'"

# Detection: what the menu shows
use_integrations env
export FAKE_GATEWAY=192.168.137.1
check "detect reports gateway, interface and URL" bash -c "'$PM' detect </dev/null | jq -e '.gateway == \"192.168.137.1\" and .iface == \"wlp2s0\" and .url == \"http://192.168.137.1:8080\"' >/dev/null"
unset FAKE_GATEWAY

teardown_env
report
