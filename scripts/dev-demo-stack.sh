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

API_LOG="${ROOT_DIR}/.tmp-api.log"
WORKER_LOG="${ROOT_DIR}/.tmp-worker.log"
DEMO_LOG="${ROOT_DIR}/.tmp-demo-web.log"
API_BASE_URL="${API_BASE_URL:-http://localhost:3000}"
DEMO_WEB_PORT="${DEMO_WEB_PORT:-3100}"
DEMO_API_BASE_URL="${DEMO_API_BASE_URL:-$API_BASE_URL}"
DEMO_URL="http://localhost:${DEMO_WEB_PORT}"

cd "${ROOT_DIR}"

cleanup() {
  for pid in "${demo_pid:-}" "${worker_pid:-}" "${api_pid:-}"; do
    if [[ -n "${pid}" ]] && kill -0 "${pid}" >/dev/null 2>&1; then
      kill "${pid}" >/dev/null 2>&1 || true
      wait "${pid}" >/dev/null 2>&1 || true
    fi
  done
}
trap cleanup EXIT INT TERM

echo "Starting StateCore demo stack..."
echo "Logs:"
echo "  API:    ${API_LOG}"
echo "  Worker: ${WORKER_LOG}"
echo "  Demo:   ${DEMO_LOG}"
echo

pnpm dev:api >"${API_LOG}" 2>&1 &
api_pid=$!

pnpm dev:worker >"${WORKER_LOG}" 2>&1 &
worker_pid=$!

DEMO_WEB_PORT="${DEMO_WEB_PORT}" DEMO_API_BASE_URL="${DEMO_API_BASE_URL}" \
  pnpm dev:demo >"${DEMO_LOG}" 2>&1 &
demo_pid=$!

wait_for_url() {
  local url="$1"
  local label="$2"
  shift 2
  local deadline=$((SECONDS + 45))
  while [[ $SECONDS -lt $deadline ]]; do
    if curl -fsS "$@" "$url" >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
  done
  echo "${label} did not become ready in time." >&2
  return 1
}

wait_for_url "${API_BASE_URL}/health" "API" -H "x-user-id: demo-stack-check" || {
  echo "API log tail:" >&2
  tail -n 40 "${API_LOG}" >&2 || true
  exit 1
}

wait_for_url "${DEMO_URL}/config.js" "Demo web" || {
  echo "Demo log tail:" >&2
  tail -n 40 "${DEMO_LOG}" >&2 || true
  exit 1
}

echo "Demo stack ready."
echo "  API:  ${API_BASE_URL}"
echo "  Demo: ${DEMO_URL}"
echo
echo "First things to try:"
echo "  1. Create a scope in the demo UI"
echo "  2. Ask: What is the current goal?"
echo "  3. Ask: What constraints still apply?"
echo "  4. Watch the hero card, turn story, and pipeline update"
echo
echo "Press Ctrl+C to stop all three processes."

wait "${api_pid}" "${worker_pid}" "${demo_pid}"
