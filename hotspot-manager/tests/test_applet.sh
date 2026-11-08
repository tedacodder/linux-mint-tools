#!/bin/bash
# Menu logic (applet.js) with mocked Cinnamon APIs. Needs node.
cd "$(dirname "$0")" || exit 1
echo "== applet menu =="
if ! command -v node >/dev/null 2>&1; then
    echo "  SKIP  node is not installed"
    exit 0
fi
node applet_logic.js | tail -1
