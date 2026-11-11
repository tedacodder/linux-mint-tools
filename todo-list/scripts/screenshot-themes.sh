#!/usr/bin/env bash
# Opens the Todo List window in each of the six themes and saves a screenshot of
# each one. The applet must be on the panel. Put your sample tasks in the list
# first, so every screenshot shows the same tasks.
#
#   bash scripts/screenshot-themes.sh [output-folder]    default: ./docs
#
# Your theme is restored at the end.
set -euo pipefail

OUT="${1:-$PWD/docs}"
THEMES="neon omarchy ember paper sakura lagoon"
DIR="${XDG_STATE_HOME:-$HOME/.local/state}/todo-list"
TRIGGER="$DIR/toggle"
SETTINGS="$DIR/settings.json"
TASKS="$DIR/todos.json"
DELAY="${SCREENSHOT_DELAY:-2}"   # seconds to let the window draw before capturing

mkdir -p "$OUT" "$DIR"

if command -v gnome-screenshot >/dev/null 2>&1; then
  capture() { gnome-screenshot -w -f "$1"; }
elif command -v scrot >/dev/null 2>&1; then
  capture() { scrot -u "$1"; }
else
  echo "error: no screenshot tool found. Install one: sudo apt install gnome-screenshot" >&2
  exit 1
fi

# Warn if the list is empty, so the screenshots are not blank.
count="$(python3 -c "
import json, sys
try:
    d = json.load(open(sys.argv[1]))
    print(len(d.get('tasks', [])) + len(d.get('dailyTasks', [])))
except Exception:
    print(0)" "$TASKS")"
if [ "$count" -eq 0 ]; then
  echo "error: the list has no tasks. Add your sample tasks in the window first." >&2
  exit 1
fi

# Remember the current theme, so it can be restored.
ORIGINAL="$(python3 -c "
import json, sys
try:
    print(json.load(open(sys.argv[1])).get('theme', 'neon'))
except Exception:
    print('neon')" "$SETTINGS")"

# The applet reads this file. A line of words is a command.
send() {
  printf '%s\n' "$1" > "$TRIGGER"
  sleep 1.5   # the applet ignores a second change within 400 ms
}

for t in $THEMES; do
  send "theme $t open"
  sleep "$DELAY"
  capture "$OUT/window-$t.png"
  echo "saved $OUT/window-$t.png"
  send "close"
done

send "theme $ORIGINAL"
echo "done. Your theme is back to $ORIGINAL. Check the first image: it should show the window, not the terminal."
