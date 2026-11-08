#!/bin/bash
set -uo pipefail

UUID="proxy-manager@tedacodder-linux"
DEST="$HOME/.local/share/cinnamon/applets/$UUID"

if [[ -x $DEST/proxy-manager.sh ]]; then
    bash "$DEST/proxy-manager.sh" disable --no-check
fi

sudo rm -f /etc/NetworkManager/dispatcher.d/99-proxy-manager \
    /usr/local/libexec/proxy-manager-apt-helper \
    /usr/share/polkit-1/actions/org.tedacodder.proxymanager.apt.policy

rm -rf "$DEST"
echo "Removed. Your settings remain in ~/.config/proxy-manager (delete that folder to remove them too)."
