#!/usr/bin/env bash
# Removes the applet files. Your tasks in ~/.local/state/todo-list/ are kept.
set -euo pipefail

UUID="todo-list@tedacodder"
DEST="$HOME/.local/share/cinnamon/applets/$UUID"

if [ -d "$DEST" ]; then
  rm -rf -- "$DEST"
  echo "Removed $DEST"
else
  echo "Nothing to remove: $DEST does not exist"
fi

echo "Your tasks were kept in $HOME/.local/state/todo-list/ (delete that folder yourself to remove them)."
echo "If the applet is still on the panel, right-click it > Remove from panel."
