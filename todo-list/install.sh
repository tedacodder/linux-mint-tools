#!/usr/bin/env bash
# Installs the Todo List applet for the current user. It copies the files in
# applet/ into ~/.local/share/cinnamon/applets/<uuid>. No sudo is needed.
set -euo pipefail

UUID="todo-list@tedacodder"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SRC="$HERE/applet"
DEST="$HOME/.local/share/cinnamon/applets/$UUID"

for f in metadata.json applet.js stylesheet.css icon-symbolic.svg; do
  if [ ! -f "$SRC/$f" ]; then
    echo "error: missing $SRC/$f" >&2
    exit 1
  fi
done

mkdir -p "$DEST"
cp -f "$SRC/metadata.json" "$SRC/applet.js" "$SRC/stylesheet.css" "$SRC/icon-symbolic.svg" "$DEST/"

echo "Installed $UUID to $DEST"
echo
echo "Restart Cinnamon: press Alt+F2, type r, press Enter."
echo "Then right-click the panel > Applets > Todo List, and add it to the panel."
echo "Ctrl+Alt+D opens the list once the applet is on the panel."
