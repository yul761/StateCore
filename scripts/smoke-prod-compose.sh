#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BASE_URL:-http://localhost}"
USER_ID="${USER_ID:-deploy-smoke}"
TIMEOUT_SECONDS="${TIMEOUT_SECONDS:-60}"
POLL_INTERVAL_SECONDS="${POLL_INTERVAL_SECONDS:-2}"

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1" >&2
    exit 1
  fi
}

require_cmd curl
require_cmd jq

api() {
  curl -fsS \
    -H "x-user-id: ${USER_ID}" \
    "$@"
}

post_json() {
  local path="$1"
  local payload="$2"
  api \
    -H "content-type: application/json" \
    -d "$payload" \
    "${BASE_URL}${path}"
}

echo "1. Checking public entrypoint"
api "${BASE_URL}/health" | jq .

echo "2. Creating smoke scope"
scope_json="$(post_json "/scopes" '{"name":"deploy smoke scope"}')"
scope_id="$(printf '%s' "$scope_json" | jq -r '.id')"
if [[ -z "$scope_id" || "$scope_id" == "null" ]]; then
  echo "Failed to create scope" >&2
  echo "$scope_json" >&2
  exit 1
fi
echo "scopeId=${scope_id}"

echo "3. Sending runtime turn"
runtime_json="$(
  post_json "/memory/runtime/turn" "$(jq -cn \
    --arg scopeId "$scope_id" \
    --arg message "I am looking to get fit, maybe squat to 200kg" \
    '{scopeId: $scopeId, message: $message, digestMode: "auto"}')"
)"
printf '%s\n' "$runtime_json" | jq .

echo "4. Waiting for Working Memory"
deadline=$((SECONDS + TIMEOUT_SECONDS))
working_json=""
while (( SECONDS < deadline )); do
  working_json="$(api "${BASE_URL}/memory/working-state?scopeId=${scope_id}")"
  if [[ "$(printf '%s' "$working_json" | jq -r '.version // empty')" != "" ]]; then
    break
  fi
  sleep "${POLL_INTERVAL_SECONDS}"
done

printf '%s\n' "$working_json" | jq .
if [[ "$(printf '%s' "$working_json" | jq -r '.view.goal // empty')" == "" ]]; then
  echo "Working Memory goal was not captured" >&2
  exit 1
fi

echo "5. Waiting for Stable State"
stable_json=""
while (( SECONDS < deadline )); do
  stable_json="$(api "${BASE_URL}/memory/stable-state?scopeId=${scope_id}")"
  if [[ "$(printf '%s' "$stable_json" | jq -r '.digestId // empty')" != "" ]]; then
    break
  fi
  sleep "${POLL_INTERVAL_SECONDS}"
done

printf '%s\n' "$stable_json" | jq .
if [[ "$(printf '%s' "$stable_json" | jq -r '.view.goal // empty')" == "" ]]; then
  echo "Stable State goal was not committed" >&2
  exit 1
fi

echo "6. Checking layer status alignment"
layer_json="$(api "${BASE_URL}/memory/layer-status?scopeId=${scope_id}")"
printf '%s\n' "$layer_json" | jq .

goal_aligned="$(printf '%s' "$layer_json" | jq -r '.layerAlignment.goalAligned')"
working_caught_up="$(printf '%s' "$layer_json" | jq -r '.freshness.workingMemoryCaughtUp')"
stable_caught_up="$(printf '%s' "$layer_json" | jq -r '.freshness.stableStateCaughtUp')"

if [[ "$goal_aligned" != "true" || "$working_caught_up" != "true" || "$stable_caught_up" != "true" ]]; then
  echo "Layer status did not converge cleanly" >&2
  exit 1
fi

echo "Deploy smoke passed."
