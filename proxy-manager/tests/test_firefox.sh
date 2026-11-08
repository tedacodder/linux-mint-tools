#!/bin/bash
# Firefox: proxy block in each profile's user.js, your own prefs left alone.
source "$(dirname "$0")/lib.sh"
echo "== firefox =="
setup_env
use_integrations firefox
PROFILE="$HOME/.mozilla/firefox/test.default"
mkdir -p "$PROFILE"
touch "$PROFILE/prefs.js"
echo 'user_pref("my.own.setting", true);' > "$PROFILE/user.js"

pm enable >/dev/null
check "firefox proxy type is manual"       grep -q 'network.proxy.type", 1' "$PROFILE/user.js"
check "firefox http host set"              grep -q "network.proxy.http\", \"192.168.137.1\"" "$PROFILE/user.js"
check "firefox http port set"              grep -q 'network.proxy.http_port", 8080' "$PROFILE/user.js"
check "firefox own pref kept"              grep -q 'my.own.setting' "$PROFILE/user.js"
pm disable --no-check >/dev/null
check "firefox proxy type back to none"    grep -q 'network.proxy.type", 0' "$PROFILE/user.js"
check "firefox own pref kept after disable" grep -q 'my.own.setting' "$PROFILE/user.js"

teardown_env
report
