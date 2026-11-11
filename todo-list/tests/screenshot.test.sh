#!/usr/bin/env bash
# Tests scripts/screenshot-themes.sh with a fake screenshot tool. The applet is not
# needed: the test checks what the script writes to the trigger file and saves.
set -euo pipefail
. "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
require_temp_home

fail() { echo "  FAIL  $1" >&2; exit 1; }
pass() { echo "  ok    $1"; }

DIR="$HOME/.local/state/todo-list"
OUT="$HOME/shots"
FAKE="$HOME/fake-bin"
mkdir -p "$DIR" "$FAKE"

# A fake screenshot tool: it writes a small file at the path it is given.
cat > "$FAKE/gnome-screenshot" << 'SH'
#!/usr/bin/env bash
# Usage in the script: gnome-screenshot -w -f FILE
while [ $# -gt 0 ]; do
  if [ "$1" = "-f" ]; then printf 'fake image' > "$2"; fi
  shift
done
SH
chmod +x "$FAKE/gnome-screenshot"
export PATH="$FAKE:$PATH"

# Without tasks the script refuses, so the screenshots are never blank.
echo '{"version":2,"tasks":[],"dailyTasks":[]}' > "$DIR/todos.json"
if SCREENSHOT_DELAY=0 bash "$PROJECT_DIR/scripts/screenshot-themes.sh" "$OUT" > /dev/null 2>&1; then
  fail "ran with an empty list"
fi
pass "refuses to run with an empty list"

# Sample tasks, and a saved theme that must come back at the end.
echo '{"version":2,"tasks":[{"id":"a","title":"Sample","status":"ongoing","priority":"high"}],"dailyTasks":[]}' > "$DIR/todos.json"
echo '{"theme":"lagoon"}' > "$DIR/settings.json"

SCREENSHOT_DELAY=0 bash "$PROJECT_DIR/scripts/screenshot-themes.sh" "$OUT" > /dev/null

for t in neon omarchy ember paper sakura lagoon; do
  [ -s "$OUT/window-$t.png" ] || fail "no screenshot for $t"
done
pass "saves one screenshot for each of the six themes"

# The last command sent restores the original theme.
last="$(tail -n 1 "$DIR/toggle")"
[ "$last" = "theme lagoon" ] || fail "the original theme was not restored (last command: $last)"
pass "restores the original theme at the end"

echo "  screenshot tests passed"
