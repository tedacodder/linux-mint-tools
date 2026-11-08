#!/bin/bash
# Runs every Hotspot Manager test. Usage: bash tests/run-all.sh
cd "$(dirname "$0")" || exit 1
if ! command -v jq >/dev/null 2>&1; then
    echo "jq is required: sudo apt install jq"
    exit 1
fi
failed=0
for t in test_*.sh; do
    echo
    bash "$t" || failed=$((failed + 1))
done
echo
if (( failed == 0 )); then echo "ALL HOTSPOT TESTS PASSED"; else echo "$failed test file(s) had failures"; fi
exit $(( failed > 0 ))
