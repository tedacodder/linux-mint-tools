#!/usr/bin/env bash
# Installs the Todo List applet for the current user. It copies the files in
# applet/ into ~/.local/share/cinnamon/applets/<uuid>. No sudo is needed.
set -euo pipefail

UUID="todo-list@tedacodder-linux"
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

# The shortcut command. It goes in ~/.local/bin, so no sudo is needed.
BIN="$HOME/.local/bin"
mkdir -p "$BIN"
cp -f "$HERE/scripts/todo-list-toggle" "$BIN/todo-list-toggle"
chmod +x "$BIN/todo-list-toggle"

echo "Installed $UUID to $DEST"
echo "Installed the shortcut command to $BIN/todo-list-toggle"
echo
echo "Restart Cinnamon: press Alt+F2, type r, press Enter."
echo "Then right-click the panel > Applets > Todo List, and add it to the panel."
echo "Ctrl+Alt+D opens the list once the applet is on the panel."
echo "If you added an old custom shortcut for it, remove it: bash scripts/set-shortcut.sh --remove"
