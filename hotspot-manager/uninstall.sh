#!/bin/bash
UUID="hotspot-manager@tedacodder-linux"
DEST="$HOME/.local/share/cinnamon/applets/$UUID"

if [[ -x $DEST/hotspot-manager.sh ]]; then
    bash "$DEST/hotspot-manager.sh" stop >/dev/null 2>&1
fi
rm -rf "$DEST"
echo "Removed. Your settings remain in ~/.config/hotspot-manager (delete that folder to remove them too)."
