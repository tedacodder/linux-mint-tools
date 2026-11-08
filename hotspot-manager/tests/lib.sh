#!/bin/bash
# Shared helpers for Hotspot Manager tests. Each test runs in a throwaway HOME with
# fake nmcli and ip commands, so no real hotspot is ever started.

TESTS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HM="$(cd "$TESTS_DIR/../applet" && pwd)/hotspot-manager.sh"
PASS=0; FAIL=0

ok()   { PASS=$((PASS + 1)); echo "  PASS  $1"; }
fail() { FAIL=$((FAIL + 1)); echo "  FAIL  $1"; }

check() {
    local desc="$1"; shift
    if "$@" >/dev/null 2>&1; then ok "$desc"; else fail "$desc"; fi
}

check_fails() {
    local desc="$1"; shift
    if "$@" >/dev/null 2>&1; then fail "$desc"; else ok "$desc"; fi
}

hm() { "$HM" "$@" < /dev/null; }

setup_env() {
    REAL_HOME="${REAL_HOME:-$HOME}"
    TEST_HOME="$(mktemp -d)"
    export HOME="$TEST_HOME"
    mkdir -p "$HOME/stubs"

    # nmcli: keeps the hotspot state in files and logs every call
    cat > "$HOME/stubs/nmcli" <<'NMCLI'
#!/bin/bash
S="$HOME/nm"; mkdir -p "$S"
echo "$*" >> "$HOME/nmcli.log"
case "$*" in
    "-t -f DEVICE,TYPE device")
        if [[ -n ${FAKE_NO_WIFI-} ]]; then printf 'enp1s0:ethernet\n'
        else printf 'wlp2s0:wifi\nenp1s0:ethernet\n'; fi ;;
    "-t -f NAME connection show --active")
        [[ -f $S/active ]] && echo "Hotspot" ;;
    "-t -f NAME connection show")
        [[ -f $S/exists ]] && echo "Hotspot"
        for i in $(seq 1 20000); do echo "Other connection $i"; done ;;
    "device wifi hotspot"*)
        if [[ -n ${FAKE_HOTSPOT_FAIL-} ]]; then echo "Error: Connection activation failed: no carrier" >&2; exit 1; fi
        touch "$S/active" "$S/exists" ;;
    "connection modify"*) touch "$S/exists" ;;
    "connection up"*)
        if [[ -n ${FAKE_HOTSPOT_FAIL-} ]]; then echo "Error: Connection activation failed: no carrier" >&2; exit 1; fi
        touch "$S/active" ;;
    "connection down"*)   rm -f "$S/active" ;;
    *) exit 0 ;;
esac
NMCLI

    # ip: the hotspot address, and the devices connected to it
    cat > "$HOME/stubs/ip" <<'IPSTUB'
#!/bin/bash
case "$*" in
    "-4 -o addr show dev "*) echo "2: wlp2s0    inet 10.42.0.1/24 brd 10.42.0.255 scope global wlp2s0" ;;
    "neigh show dev "*)      cat "$HOME/neigh.txt" 2>/dev/null ;;
esac
IPSTUB
        # qrencode: records what it was asked to encode and writes an empty image file
    cat > "$HOME/stubs/qrencode" <<'QRSTUB'
#!/bin/bash
echo "$*" >> "$HOME/qr.log"
out=""; prev=""
for a in "$@"; do [[ $prev == -o ]] && out="$a"; prev="$a"; done
[[ -n $out ]] && : > "$out"
QRSTUB
    chmod +x "$HOME/stubs/nmcli" "$HOME/stubs/ip" "$HOME/stubs/qrencode"
    export PATH="$HOME/stubs:$PATH"
}

teardown_env() {
    rm -rf "$TEST_HOME"
    export HOME="$REAL_HOME"
}

report() {
    echo "  -> $PASS passed, $FAIL failed"
    (( FAIL == 0 ))
}
