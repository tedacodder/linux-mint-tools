#!/bin/bash
set -euo pipefail

UUID="proxy-manager@tedacodder-linux"
SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEST="$HOME/.local/share/cinnamon/applets/$UUID"

echo "==> Installing dependencies"
sudo apt-get install -y jq libnotify-bin iproute2

echo "==> Installing applet to $DEST"
mkdir -p "$DEST"
cp -r "$SRC/applet/." "$DEST/"
chmod +x "$DEST/proxy-manager.sh" "$DEST/proxy-browser"

echo "==> Installing apt helper and polkit policy (needs sudo)"
sudo install -Dm755 "$SRC/system/proxy-manager-apt-helper" /usr/local/libexec/proxy-manager-apt-helper
sudo install -Dm644 "$SRC/system/org.tedacodder.proxymanager.apt.policy" \
    /usr/share/polkit-1/actions/org.tedacodder.proxymanager.apt.policy

echo "==> Installing NetworkManager dispatcher hook (needs sudo)"
sed -e "s|__USER__|$USER|g" \
    -e "s|__HOME__|$HOME|g" \
    -e "s|__UID__|$(id -u)|g" \
    -e "s|__APPLET__|$DEST/proxy-manager.sh|g" \
    "$SRC/system/99-proxy-manager.tpl" | sudo tee /etc/NetworkManager/dispatcher.d/99-proxy-manager >/dev/null
sudo chmod 755 /etc/NetworkManager/dispatcher.d/99-proxy-manager

echo
echo "Installed. Restart Cinnamon (Alt+F2, type r, Enter), then right-click the"
echo "panel, choose Applets, and add 'Proxy Manager'."
