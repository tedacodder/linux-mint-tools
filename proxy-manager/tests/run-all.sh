#!/bin/bash
# Runs every feature test. Usage: bash tests/run-all.sh
# Or run one feature:           bash tests/test_git.sh
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
if (( failed == 0 )); then
    echo "ALL FEATURE TESTS PASSED"
else
    echo "$failed feature test file(s) had failures; see FAIL lines above"
fi
exit $(( failed > 0 ))
