#!/bin/bash
# NetworkManager dispatcher hook installed by Proxy Manager.
# Re-applies the proxy as the owning user when the network changes.
ACTION="${2:-}"
case "$ACTION" in
    up|down|dhcp4-change|dhcp6-change|connectivity-change|vpn-up|vpn-down) ;;
    *) exit 0 ;;
esac
runuser -u "__USER__" -- env HOME="__HOME__" XDG_RUNTIME_DIR="/run/user/__UID__" \
    bash "__APPLET__" gateway-change >/dev/null 2>&1 &
exit 0
