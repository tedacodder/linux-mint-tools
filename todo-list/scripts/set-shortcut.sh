#!/usr/bin/env bash
# Adds, or removes, the keyboard shortcut that opens the Todo List window.
#
#   scripts/set-shortcut.sh                  add Ctrl+Alt+D (default)
#   scripts/set-shortcut.sh '<Super>t'       add a different key combination
#   scripts/set-shortcut.sh --remove         remove the shortcut
#
# It edits Cinnamon's custom shortcut list and keeps the shortcuts you already
# have. Run install.sh first, so the command exists.
set -euo pipefail

SCHEMA=org.cinnamon.desktop.keybindings
KEY=todo-list
P="/org/cinnamon/desktop/keybindings/custom-keybindings/$KEY/"
COMMAND="$HOME/.local/bin/todo-list-toggle"
DEFAULT_BINDING='<Primary><Alt>d'

if ! command -v gsettings >/dev/null 2>&1; then
  echo "error: gsettings is not available on this system" >&2
  exit 1
fi

# Writes the new custom-list to stdout. $1 is the current list, $2 is "add" or "remove".
new_list() {
  python3 - "$1" "$KEY" "$2" << 'PY'
import ast, sys
raw, key, action = sys.argv[1], sys.argv[2], sys.argv[3]
text = raw.replace('@as ', '').strip()
items = ast.literal_eval(text) if text else []
items = [x for x in items if x != key]
if action == 'add':
    items.append(key)
print(repr(items))
PY
}

if [ "${1:-}" = "--remove" ]; then
  CUR="$(gsettings get $SCHEMA custom-list)"
  gsettings set $SCHEMA custom-list "$(new_list "$CUR" remove)"
  gsettings reset $SCHEMA.custom-keybinding:"$P" name 2>/dev/null || true
  gsettings reset $SCHEMA.custom-keybinding:"$P" command 2>/dev/null || true
  gsettings reset $SCHEMA.custom-keybinding:"$P" binding 2>/dev/null || true
  echo "Removed the Todo List shortcut."
  exit 0
fi

BINDING="${1:-$DEFAULT_BINDING}"

if [ ! -x "$COMMAND" ]; then
  echo "error: $COMMAND not found. Run install.sh first." >&2
  exit 1
fi

CUR="$(gsettings get $SCHEMA custom-list)"
gsettings set $SCHEMA custom-list "$(new_list "$CUR" add)"
gsettings set $SCHEMA.custom-keybinding:"$P" name 'Todo List'
gsettings set $SCHEMA.custom-keybinding:"$P" command "$COMMAND"
gsettings set $SCHEMA.custom-keybinding:"$P" binding "['$BINDING']"

echo "Added the Todo List shortcut: $BINDING"
echo "Press it to open the window. If it does nothing, restart Cinnamon (Alt+F2, r, Enter)."
