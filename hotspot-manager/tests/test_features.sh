#!/bin/bash
# New features: device names from the DHCP leases, the laptop name, and the QR join code.
source "$(dirname "$0")/lib.sh"
echo "== features =="
setup_env

export HM_LEASE_DIR="$HOME/leases"
mkdir -p "$HM_LEASE_DIR"
hm set-ssid cody >/dev/null
hm set-password testpass1 >/dev/null
hm start >/dev/null
cat > "$HM_LEASE_DIR/dnsmasq-wlp2s0.leases" <<'LEASES'
1794000000 9e:02:16:ad:a4:b9 10.42.0.132 Galaxy-S24 01:9e:02:16:ad:a4:b9
1794000000 aa:bb:cc:dd:ee:01 10.42.0.23 * 01:aa:bb:cc:dd:ee:01
LEASES
cat > "$HOME/neigh.txt" <<'NEIGH'
10.42.0.132 dev wlp2s0 lladdr 9E:02:16:AD:A4:B9 REACHABLE
10.42.0.23 dev wlp2s0 lladdr aa:bb:cc:dd:ee:01 STALE
NEIGH

check "a device is named from its DHCP lease"       bash -c "'$HM' status </dev/null | jq -e '.clients[] | select(.mac == \"9e:02:16:ad:a4:b9\") | .name == \"Galaxy-S24\"' >/dev/null"
check "MAC matching ignores upper and lower case"    bash -c "'$HM' status </dev/null | jq -e '.clients[] | select(.mac == \"9e:02:16:ad:a4:b9\") | .name != \"\"' >/dev/null"
check "a device that sent no name has an empty name" bash -c "'$HM' status </dev/null | jq -e '.clients[] | select(.mac == \"aa:bb:cc:dd:ee:01\") | .name == \"\"' >/dev/null"
check "status includes the laptop name"              bash -c "'$HM' status </dev/null | jq -e '.host | length > 0' >/dev/null"
check "a missing lease file does not break status"   bash -c "HM_LEASE_DIR=/nonexistent '$HM' status </dev/null | jq -e '.active == true' >/dev/null"

# QR join code: WIFI:T:WPA;S:<ssid>;P:<password>;;
check "qr makes an image and returns its path"       bash -c "'$HM' qr </dev/null | jq -e '.path | endswith(\"join.png\")' >/dev/null"
check "the QR code holds the Wi-Fi join string"      grep -qF 'WIFI:T:WPA;S:cody;P:testpass1;;' "$HOME/qr.log"
hm set-ssid 'a;b' >/dev/null
hm qr >/dev/null
check "special characters in the name are escaped"   grep -qF 'WIFI:T:WPA;S:a\;b;P:testpass1;;' "$HOME/qr.log"
hm set-ssid cody >/dev/null
check "the QR file is private (600)"                 bash -c "[[ \$(stat -c %a '$HOME/.config/hotspot-manager/qr/join.png') == 600 ]]"

teardown_env
report
