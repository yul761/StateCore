#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

if [[ -f "${ROOT_DIR}/.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "${ROOT_DIR}/.env"
  set +a
fi

API_BASE_URL="${API_BASE_URL:-http://localhost:3000}"
DEMO_WEB_PORT="${DEMO_WEB_PORT:-3100}"
DEMO_API_BASE_URL="${DEMO_API_BASE_URL:-$API_BASE_URL}"
LOG_PATH="${ROOT_DIR}/.tmp-demo-web.log"

if ! command -v curl >/dev/null 2>&1; then
  echo "curl is required" >&2
  exit 1
fi

if ! command -v jq >/dev/null 2>&1; then
  echo "jq is required" >&2
  exit 1
fi

health_json=$(curl -sS -H "x-user-id: demo-web-smoke-user" "${API_BASE_URL}/health")
health_status=$(printf "%s" "$health_json" | jq -r '.status')
if [[ "${health_status}" != "ok" ]]; then
  echo "API health check failed before demo-web smoke" >&2
  echo "$health_json"
  exit 1
fi

pnpm --filter @project-memory/demo-web build >/dev/null

DEMO_WEB_PORT="$DEMO_WEB_PORT" DEMO_API_BASE_URL="$DEMO_API_BASE_URL" \
  pnpm --filter @project-memory/demo-web start >"$LOG_PATH" 2>&1 &
server_pid=$!

cleanup() {
  if kill -0 "$server_pid" >/dev/null 2>&1; then
    kill "$server_pid" >/dev/null 2>&1 || true
    wait "$server_pid" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

deadline=$((SECONDS + 30))
config_js=""
while [[ $SECONDS -lt $deadline ]]; do
  if config_js=$(curl -sS "http://localhost:${DEMO_WEB_PORT}/config.js" 2>/dev/null); then
    if [[ -n "${config_js}" ]]; then
      break
    fi
  fi
  sleep 1
done

if [[ -z "${config_js}" ]]; then
  echo "demo-web did not start in time" >&2
  cat "$LOG_PATH" >&2 || true
  exit 1
fi

index_html=$(curl -sS "http://localhost:${DEMO_WEB_PORT}/")

if [[ "${index_html}" != *"Project Memory Demo"* ]]; then
  echo "demo-web index did not contain expected title" >&2
  exit 1
fi

if [[ "${config_js}" != *"PROJECT_MEMORY_DEMO_CONFIG"* ]]; then
  echo "demo-web config missing PROJECT_MEMORY_DEMO_CONFIG" >&2
  exit 1
fi

if [[ "${config_js}" != *"/memory/runtime/turn"* ]]; then
  echo "demo-web config missing runtime route" >&2
  exit 1
fi

if [[ "${config_js}" != *"${DEMO_API_BASE_URL}"* ]]; then
  echo "demo-web config missing expected API base URL" >&2
  exit 1
fi

echo "Demo web smoke passed."
echo "Health:"
printf "%s" "$health_json" | jq '{status, featureLlm, model: .model.runtimeModel}'
echo "Demo config:"
printf "%s\n" "$config_js" | sed -n '1,4p'
