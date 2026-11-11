#!/usr/bin/env bash
# Shared test helpers. Tests run with HOME set to a temporary directory.

TESTS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$TESTS_DIR/.." && pwd)"

# Prints the path of a new temporary HOME.
new_temp_home() {
  mktemp -d "${TMPDIR:-/tmp}/todo-list-test.XXXXXX"
}

# Stops the test if HOME is not one of the temporary test homes.
require_temp_home() {
  case "$HOME" in
    *todo-list-test*) ;;
    *)
      echo "refusing to run: HOME is not a temporary test home ($HOME)" >&2
      exit 1
      ;;
  esac
}
