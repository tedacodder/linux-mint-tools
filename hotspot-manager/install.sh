#!/bin/bash
set -euo pipefail

UUID="hotspot-manager@tedacodder-linux"
SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEST="$HOME/.local/share/cinnamon/applets/$UUID"

echo "==> Installing jq and qrencode (JSON handling and the QR join code)"
sudo apt-get install -y jq qrencode

echo "==> Installing applet to $DEST"
mkdir -p "$DEST"
cp -r "$SRC/applet/." "$DEST/"
chmod +x "$DEST/hotspot-manager.sh"

echo
echo "Installed. Restart Cinnamon (Alt+F2, type r, Enter), then right-click the panel,"
echo "choose Applets, and add 'Hotspot Manager'."
