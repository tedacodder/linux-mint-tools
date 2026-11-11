#!/usr/bin/env bash
# Runs every test in tests/. Each file gets its own temporary HOME, so the
# real home folder is never read or written. Nothing here uses sudo.
set -euo pipefail
. "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

if ! command -v node >/dev/null 2>&1; then
  echo "node is required to run the tests (for example: sudo apt install nodejs)" >&2
  exit 1
fi

status=0

run_one() {
  local name="$1"
  shift
  local home
  home="$(new_temp_home)"
  echo "== $name"
  if env -u XDG_STATE_HOME -u XDG_DATA_HOME HOME="$home" "$@"; then
    echo "   ok"
  else
    echo "   FAILED: $name"
    status=1
  fi
  rm -rf -- "$home"
}

for t in "$TESTS_DIR"/*.test.js; do
  run_one "$(basename "$t")" node "$t"
done
run_one "install.test.sh" bash "$TESTS_DIR/install.test.sh"
run_one "shortcut.test.sh" bash "$TESTS_DIR/shortcut.test.sh"
run_one "screenshot.test.sh" bash "$TESTS_DIR/screenshot.test.sh"
run_one "theme-gif.test.sh" bash "$TESTS_DIR/theme-gif.test.sh"

echo
if [ "$status" -eq 0 ]; then
  echo "all test files passed"
else
  echo "some tests failed"
fi
exit "$status"
