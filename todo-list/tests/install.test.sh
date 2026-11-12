#!/usr/bin/env bash
# Install and uninstall into a temporary HOME. The real home folder is never
# touched, and nothing here needs sudo.
set -euo pipefail
. "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
require_temp_home

fail() { echo "  FAIL  $1" >&2; exit 1; }
pass() { echo "  ok    $1"; }

UUID="todo-list@tedacodder"
DEST="$HOME/.local/share/cinnamon/applets/$UUID"
STATE="$HOME/.local/state/todo-list"

bash "$PROJECT_DIR/install.sh" > /dev/null
for f in metadata.json applet.js stylesheet.css icon-symbolic.svg; do
  [ -f "$DEST/$f" ] || fail "install did not copy $f"
done
pass "install copies the four applet files"



if ! grep -q "\"uuid\": \"$UUID\"" "$DEST/metadata.json"; then
  fail "installed metadata.json has the wrong uuid"
fi
pass "installed metadata.json has the right uuid"

bash "$PROJECT_DIR/install.sh" > /dev/null
[ -f "$DEST/applet.js" ] || fail "second install removed files"
pass "install can run twice"

mkdir -p "$STATE"
echo '{"version":2,"tasks":[]}' > "$STATE/todos.json"
bash "$PROJECT_DIR/uninstall.sh" > /dev/null
[ ! -d "$DEST" ] || fail "uninstall left the applet folder behind"
pass "uninstall removes the applet folder"

[ -f "$STATE/todos.json" ] || fail "uninstall deleted the tasks file"
pass "uninstall keeps the tasks file"

bash "$PROJECT_DIR/uninstall.sh" > /dev/null
pass "uninstall can run when nothing is installed"

echo "  install tests passed"
