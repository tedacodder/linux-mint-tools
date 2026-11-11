#!/usr/bin/env bash
# Tests scripts/set-shortcut.sh with a fake gsettings. Real Cinnamon settings
# are never read or written. Runs in a temporary HOME.
set -euo pipefail
. "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
require_temp_home

fail() { echo "  FAIL  $1" >&2; exit 1; }
pass() { echo "  ok    $1"; }

FAKE="$HOME/fake-gsettings"
mkdir -p "$FAKE/bin" "$FAKE/store" "$HOME/.local/bin"
cat > "$FAKE/bin/gsettings" << 'GS'
#!/usr/bin/env bash
# Fake gsettings: stores values in files, so the script's reads and writes are visible.
set -eu
store="$FAKE_GSETTINGS_STORE"
cmd="$1"; schema="$2"; key="${3:-}"
name="$(printf '%s' "$schema:$key" | tr '/:' '__')"
case "$cmd" in
  get)
    if [ -f "$store/$name" ]; then cat "$store/$name"
    elif [ "$key" = "custom-list" ]; then echo "@as []"
    else echo "''"; fi ;;
  set)
    printf '%s' "$4" > "$store/$name" ;;
  reset)
    rm -f "$store/$name" ;;
  *) echo "fake gsettings: unknown command $cmd" >&2; exit 1 ;;
esac
GS
chmod +x "$FAKE/bin/gsettings"
export FAKE_GSETTINGS_STORE="$FAKE/store"
export PATH="$FAKE/bin:$PATH"
SCRIPT="$PROJECT_DIR/scripts/set-shortcut.sh"
LIST="$FAKE/store/org.cinnamon.desktop.keybindings_custom-list"
# The fake stores each setting in a file whose name ends in the setting's key.
# The globs are expanded when each check runs, after the script has written them.

# Without the command installed, the script refuses and changes nothing.
if bash "$SCRIPT" >/dev/null 2>&1; then fail "ran without the toggle command installed"; fi
[ ! -f "$LIST" ] || fail "changed the shortcut list when it should not have"
pass "refuses to run before install.sh"

# Install the command the way install.sh does.
cp "$PROJECT_DIR/scripts/todo-list-toggle" "$HOME/.local/bin/todo-list-toggle"
chmod +x "$HOME/.local/bin/todo-list-toggle"

# Existing custom shortcuts are kept.
printf '%s' "['custom0', 'greeting-lock']" > "$LIST"
bash "$SCRIPT" > /dev/null
grep -q "custom0" "$LIST" || fail "an existing shortcut was lost"
grep -q "greeting-lock" "$LIST" || fail "an existing shortcut was lost"
grep -q "todo-list" "$LIST" || fail "todo-list was not added to the list"
pass "adds to the list and keeps existing shortcuts"

# The default key, name and command are set.
grep -q "<Primary><Alt>d" "$FAKE/store/"*binding || fail "default binding is not Ctrl+Alt+D"
grep -q "Todo List" "$FAKE/store/"*name || fail "name not set"
grep -q "todo-list-toggle" "$FAKE/store/"*command || fail "command not set"
pass "sets Ctrl+Alt+D, the name and the command"

# Running it again does not duplicate the entry.
bash "$SCRIPT" > /dev/null
count="$(python3 -c "import sys; print(open(sys.argv[1]).read().count('todo-list'))" "$LIST")"
[ "$count" -eq 1 ] || fail "running twice duplicated the entry ($count copies)"
pass "running twice does not duplicate the entry"

# A different key can be given.
bash "$SCRIPT" '<Super>t' > /dev/null
grep -q "<Super>t" "$FAKE/store/"*binding || fail "custom binding was not set"
pass "accepts a different key combination"

# Removing takes the shortcut out and keeps the others.
bash "$SCRIPT" --remove > /dev/null
grep -q "todo-list" "$LIST" && fail "--remove left todo-list in the list"
grep -q "custom0" "$LIST" || fail "--remove removed another shortcut"
pass "--remove takes out only the Todo List shortcut"

echo "  shortcut tests passed"
