#!/bin/bash
# VS Code: adds the proxy lines and keeps comments and your own settings.
source "$(dirname "$0")/lib.sh"
echo "== VS Code =="
setup_env
use_integrations vscode
VS="$HOME/.config/Code/User/settings.json"
mkdir -p "$(dirname "$VS")"
cat > "$VS" <<'SETTINGS'
// my settings
{
    // editor
    "editor.fontSize": 14,
    "files.autoSave": "off"
}
SETTINGS

pm enable >/dev/null
check "vscode http.proxy added"            grep -q "\"http.proxy\": \"$GATEWAY_URL\"" "$VS"
check "vscode proxyStrictSSL added"        grep -q '"http.proxyStrictSSL": false' "$VS"
check "vscode comments kept"               grep -q '// my settings' "$VS"
check "vscode own setting kept"            grep -q '"editor.fontSize": 14' "$VS"
pm disable --no-check >/dev/null
check_fails "vscode http.proxy removed"    grep -q 'http.proxy' "$VS"
check "vscode comments kept after disable" grep -q '// my settings' "$VS"
check "vscode own setting kept after disable" grep -q '"files.autoSave": "off"' "$VS"

teardown_env
report
