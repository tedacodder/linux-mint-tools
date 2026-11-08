#!/bin/bash
# Shared helpers for the Proxy Manager tests.
# Every test runs in a throwaway HOME, so your real git, shell, VS Code,
# Firefox, Docker and system proxy settings are never touched.

TESTS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PM="$(cd "$TESTS_DIR/../applet" && pwd)/proxy-manager.sh"
PASS=0; FAIL=0; SKIP=0
GATEWAY_HOST="192.168.137.1"
GATEWAY_PORT="8080"
GATEWAY_URL="http://$GATEWAY_HOST:$GATEWAY_PORT"

ok()   { PASS=$((PASS + 1)); echo "  PASS  $1"; }
fail() { FAIL=$((FAIL + 1)); echo "  FAIL  $1"; }
skip() { SKIP=$((SKIP + 1)); echo "  SKIP  $1"; }

# check "description" command args...      passes when the command succeeds
check() {
    local desc="$1"; shift
    if "$@" >/dev/null 2>&1; then ok "$desc"; else fail "$desc"; fi
}

# check_fails "description" command args... passes when the command fails
check_fails() {
    local desc="$1"; shift
    if "$@" >/dev/null 2>&1; then fail "$desc"; else ok "$desc"; fi
}

# expect "description" "expected output" command args...
expect() {
    local desc="$1" want="$2"; shift 2
    local got
    got="$("$@" 2>/dev/null)"
    if [[ $got == "$want" ]]; then ok "$desc"; else fail "$desc (wanted '$want', got '$got')"; fi
}

# Run the proxy script without a terminal on stdin.
pm() { "$PM" "$@" < /dev/null; }

# status_is 'jq expression'   passes when the status JSON matches
status_is() { pm status | jq -e "$1" >/dev/null 2>&1; }

setup_env() {
    REAL_HOME="${REAL_HOME:-$HOME}"
    TEST_HOME="$(mktemp -d)"
    export HOME="$TEST_HOME"
    mkdir -p "$HOME/.config" "$HOME/stubs" "$HOME/sysapps"

    # gsettings: records calls and keeps the proxy mode and host in files
    cat > "$HOME/stubs/gsettings" <<'EOF'
#!/bin/bash
echo "$@" >> "$HOME/gsettings.log"
if [[ $1 == get ]]; then
    if [[ $3 == host ]]; then
        if [[ -f $HOME/gsettings.host ]]; then cat "$HOME/gsettings.host"; else echo "''"; fi
    elif [[ -f $HOME/gsettings.mode ]]; then
        cat "$HOME/gsettings.mode"
    else
        echo "'none'"
    fi
elif [[ $1 == set && $3 == mode ]]; then
    echo "'$4'" > "$HOME/gsettings.mode"
elif [[ $1 == set && $3 == host ]]; then
    echo "'$4'" > "$HOME/gsettings.host"
fi
EOF
    # curl: only the gateway check (-w) is faked. A proxy answers 204 only if it is
    # listed in FAKE_PROXY_OK. Other requests succeed without touching the network.
    cat > "$HOME/stubs/curl" <<'EOF'
#!/bin/bash
proxy=""; code_mode=false; prev=""
for arg in "$@"; do
    case "$prev" in --proxy) proxy="$arg" ;; esac
    [[ $arg == -w ]] && code_mode=true
    prev="$arg"
done
if [[ -z $proxy ]]; then exit 0; fi
hostport="${proxy#http://}"
if [[ " ${FAKE_PROXY_OK-192.168.137.1:8080 192.168.137.5:8081 192.168.137.7:8081 192.168.137.9:8082} " == *" $hostport "* ]]; then
    $code_mode && printf '204 0.01'
    exit 0
fi
$code_mode && printf '000 0.00'
exit 7
EOF
    # ip: only "ip route show default" is used by Proxy Manager
    cat > "$HOME/stubs/ip" <<'EOF'
#!/bin/bash
if [[ $* == "route show default" ]]; then
    echo "default via ${FAKE_GATEWAY:-192.168.137.1} dev wlp2s0 proto dhcp metric 600"
fi
EOF

    # npm must not touch the real user config, even if NPM_CONFIG_USERCONFIG is set
    export NPM_CONFIG_USERCONFIG="$HOME/.npmrc"
    export NPM_CONFIG_GLOBALCONFIG="$HOME/.npmrc-global"
    # pkexec: runs the command directly, so tests never ask for a password
    cat > "$HOME/stubs/pkexec" <<'EOF'
#!/bin/bash
exec "$@"
EOF
    # apt helper: writes into the test home instead of /etc
    cat > "$HOME/apt-helper" <<'EOF'
#!/bin/bash
case "$1" in
    set)    echo "$2" > "$HOME/apt-proxy.conf" ;;
    remove) rm -f "$HOME/apt-proxy.conf" ;;
esac
EOF
    chmod +x "$HOME/stubs/"* "$HOME/apt-helper"

    # fake system launcher for the browser integration
    printf '[Desktop Entry]\nName=Chrome\nExec=/usr/bin/google-chrome-stable %%U\n' \
        > "$HOME/sysapps/google-chrome.desktop"

    export PATH="$HOME/stubs:$PATH"
    export PROXY_APT_HELPER="$HOME/apt-helper"
    export PROXY_SYS_APPS="$HOME/sysapps"
}

# Write a config that only enables the listed integrations, with a fixed gateway.
use_integrations() {
    local list
    list=$(printf '%s\n' "$@" | jq -R . | jq -s .)
    mkdir -p "$HOME/.config/proxy-manager"
    jq -n --argjson list "$list" --arg url "$GATEWAY_URL" --argjson port "$GATEWAY_PORT" '{
        httpProxy: $url, httpsProxy: $url, noProxy: "localhost,127.0.0.1,::1",
        gatewayAuto: false, port: $port, integrations: $list, enabled: false
    }' > "$HOME/.config/proxy-manager/proxy.json"
}

teardown_env() {
    "$PM" disable --no-check >/dev/null 2>&1 < /dev/null
    rm -rf "$TEST_HOME"
    export HOME="$REAL_HOME"
}

# Prints the totals for this test file. Exit status is non-zero if anything failed.
report() {
    echo "  -> $PASS passed, $FAIL failed, $SKIP skipped"
    (( FAIL == 0 ))
}
