#!/bin/bash
# Hotspot Manager: settings, validation, start/stop commands, and the device list.
source "$(dirname "$0")/lib.sh"
echo "== hotspot =="
setup_env

ssid_is()  { hm status | jq -e --arg s "$1" '.ssid == $s' >/dev/null; }
logged()   { grep -qxF "$1" "$HOME/nmcli.log"; }
is_on()    { hm status | jq -e '.active == true' >/dev/null; }
is_off()   { hm status | jq -e '.active == false' >/dev/null; }
pw_is()    { hm show-password | jq -e --arg p "$1" '.password == $p' >/dev/null; }
new_pw_ok() {
    local p
    p=$(jq -r '.password' "$HOME/.config/hotspot-manager/config.json")
    [[ ${#p} == 12 && $p =~ ^[A-Za-z0-9]+$ ]]
}

check "status works with no hotspot running"           is_off
check "config file is created on first run"            test -f "$HOME/.config/hotspot-manager/config.json"
check "config file is private (600)"                   bash -c "[[ \$(stat -c %a '$HOME/.config/hotspot-manager/config.json') == 600 ]]"
check "first password is 12 readable characters"       new_pw_ok
check_fails "SSID longer than 32 characters is refused" hm set-ssid "$(printf 'a%.0s' {1..33})"
check_fails "empty SSID is refused"                    hm set-ssid ""
check_fails "password shorter than 8 is refused"       hm set-password "1234567"
check_fails "password with a tab is refused"           hm set-password "$(printf 'abcdefgh\t')"
check "a valid password is saved"                      hm set-password testpass1
check "show-password returns the saved password"       pw_is testpass1
check "generate-password replaces it with a new one"   hm generate-password
check_fails "generated password is not the old one"    pw_is testpass1
check "set-ssid cody is saved"                         hm set-ssid cody
check "the SSID shows up in status"                    ssid_is cody
check_fails "an unknown Wi-Fi adapter is refused"      hm set-iface nope

# Start runs the same call as: nmcli device wifi hotspot ifname wlp2s0 ssid cody password testpass1
hm set-password testpass1 >/dev/null
hm set-ssid cody >/dev/null
check "start runs the hotspot command for wlp2s0"      hm start
check "nmcli got the exact hotspot arguments"          logged "device wifi hotspot ifname wlp2s0 con-name Hotspot ssid cody password testpass1"
check "status shows the hotspot is on"                 is_on
check "status shows the hotspot address and adapter"   bash -c "'$HM' status </dev/null | jq -e '.ip == \"10.42.0.1\" and .iface == \"wlp2s0\"' >/dev/null"
check "the hotspot will not start on boot"             logged "connection modify Hotspot connection.autoconnect no"

# Connected devices: failed entries are ignored
cat > "$HOME/neigh.txt" <<'LIST'
10.42.0.23 dev wlp2s0 lladdr aa:bb:cc:dd:ee:01 REACHABLE
10.42.0.24 dev wlp2s0 lladdr aa:bb:cc:dd:ee:02 STALE
10.42.0.25 dev wlp2s0 FAILED
LIST
check "two connected devices are counted, failed one ignored" bash -c "'$HM' status </dev/null | jq -e '.clientCount == 2' >/dev/null"
check "each device has its IP, MAC and state"          bash -c "'$HM' status </dev/null | jq -e '.clients[0].ip == \"10.42.0.23\" and .clients[0].mac == \"aa:bb:cc:dd:ee:01\" and .clients[0].state == \"REACHABLE\"' >/dev/null"
rm -f "$HOME/neigh.txt"

# Starting again edits the existing connection instead of making a second one
check "starting again updates the existing connection" hm start
check "it used modify and up, not a second hotspot"    logged "connection up Hotspot ifname wlp2s0"

# Changing the SSID while it runs restarts it with the new name
check "changing the SSID while on restarts it"         hm set-ssid newname
check "the new SSID is live"                           ssid_is newname
check "the restart used the new name"                  logged "connection modify Hotspot 802-11-wireless.ssid newname wifi-sec.psk testpass1"

# Stop
check "stop turns it off"                              hm stop
check "status shows it is off after stop"              is_off
check "nmcli got connection down Hotspot"              logged "connection down Hotspot"

# Failure is reported, not hidden
export FAKE_HOTSPOT_FAIL=1
check_fails "a failing start reports an error"         hm start
check "the error message reaches the menu"             bash -c "'$HM' start </dev/null 2>/dev/null | jq -e 'has(\"error\")' >/dev/null"
unset FAKE_HOTSPOT_FAIL

# No Wi-Fi adapter
export FAKE_NO_WIFI=1
check_fails "start refuses when there is no Wi-Fi adapter" hm start
check "the reason is 'no Wi-Fi adapter found'"         bash -c "'$HM' start </dev/null 2>/dev/null | jq -e '.error == \"no Wi-Fi adapter found\"' >/dev/null"
unset FAKE_NO_WIFI

check "ifaces lists the Wi-Fi adapter only"            bash -c "'$HM' ifaces </dev/null | jq -e '. == [\"wlp2s0\"]' >/dev/null"
check "set-iface accepts an adapter that exists"       hm set-iface wlp2s0

teardown_env
report
