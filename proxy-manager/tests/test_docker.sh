#!/bin/bash
# Docker client: proxy passed to containers in ~/.docker/config.json.
source "$(dirname "$0")/lib.sh"
echo "== docker =="
setup_env
use_integrations docker
DOCKER_CFG="$HOME/.docker/config.json"

pm enable >/dev/null
check "docker proxy set"              jq -e ".proxies.default.httpProxy == \"$GATEWAY_URL\"" "$DOCKER_CFG"
check "docker noProxy set"            jq -e '.proxies.default.noProxy | contains("localhost")' "$DOCKER_CFG"
pm disable --no-check >/dev/null
check_fails "docker proxy removed"    jq -e '.proxies.default' "$DOCKER_CFG"

teardown_env
report
