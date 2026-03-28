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
USER_ID="${USER_ID:-smoke-runtime-user}"

if [[ "${FEATURE_LLM:-false}" != "true" ]]; then
  echo "FEATURE_LLM must be true for runtime smoke" >&2
  exit 1
fi

if [[ -z "${OPENAI_API_KEY:-${MODEL_API_KEY:-}}" ]]; then
  echo "An API key is required for runtime smoke" >&2
  exit 1
fi

if ! command -v curl >/dev/null 2>&1; then
  echo "curl is required" >&2
  exit 1
fi

if ! command -v jq >/dev/null 2>&1; then
  echo "jq is required" >&2
  exit 1
fi

scope_json=$(curl -sS -X POST "$API_BASE_URL/scopes" \
  -H "x-user-id: $USER_ID" \
  -H "Content-Type: application/json" \
  -d '{"name":"Smoke Runtime","goal":"verify three-layer runtime metadata"}')

scope_id=$(printf "%s" "$scope_json" | jq -r '.id')
if [[ -z "${scope_id}" || "${scope_id}" == "null" ]]; then
  echo "Failed to create scope" >&2
  echo "$scope_json"
  exit 1
fi

curl -sS -X POST "$API_BASE_URL/scopes/$scope_id/active" \
  -H "x-user-id: $USER_ID" \
  -H "Content-Type: application/json" >/dev/null

for content in \
  'goal: ship a three-layer memory runtime for local LLM agents' \
  'constraint: keep the fast path low latency' \
  'constraint: working memory may be approximate but session scoped' \
  'We decide that stable state remains on the controlled digest pipeline' \
  'TODO: add working memory inspection endpoints'
do
  curl -sS -X POST "$API_BASE_URL/memory/events" \
    -H "x-user-id: $USER_ID" \
    -H "Content-Type: application/json" \
    -d "{\"scopeId\":\"$scope_id\",\"type\":\"stream\",\"source\":\"api\",\"content\":\"$content\"}" >/dev/null
done

curl -sS -X POST "$API_BASE_URL/memory/digest" \
  -H "x-user-id: $USER_ID" \
  -H "Content-Type: application/json" \
  -d "{\"scopeId\":\"$scope_id\"}" >/dev/null

curl -sS -X POST "$API_BASE_URL/memory/runtime/turn" \
  -H "x-user-id: $USER_ID" \
  -H "Content-Type: application/json" \
  -d "{\"scopeId\":\"$scope_id\",\"message\":\"status: runtime smoke verifies layer metadata\",\"source\":\"sdk\",\"writeTier\":\"stable\",\"digestMode\":\"skip\"}" >/dev/null

deadline=$((SECONDS + 90))
working_state_json=""
working_version="0"
while [[ $SECONDS -lt $deadline ]]; do
  working_state_json=$(curl -sS -G "$API_BASE_URL/memory/working-state" \
    -H "x-user-id: $USER_ID" \
    --data-urlencode "scopeId=$scope_id")
  working_version=$(printf "%s" "$working_state_json" | jq -r '.version')
  if [[ "${working_version}" != "null" && -n "${working_version}" && "${working_version}" != "0" ]]; then
    break
  fi
  sleep 2
done

stable_state_json=""
while [[ $SECONDS -lt $deadline ]]; do
  stable_state_json=$(curl -sS -G "$API_BASE_URL/memory/stable-state" \
    -H "x-user-id: $USER_ID" \
    --data-urlencode "scopeId=$scope_id")
  stable_digest_id=$(printf "%s" "$stable_state_json" | jq -r '.digestId')
  if [[ "${stable_digest_id}" != "null" && -n "${stable_digest_id}" ]]; then
    break
  fi
  sleep 2
done

layer_status_json=$(curl -sS -G "$API_BASE_URL/memory/layer-status" \
  -H "x-user-id: $USER_ID" \
  --data-urlencode "scopeId=$scope_id" \
  --data-urlencode "message=What is the current architecture goal?")

runtime_json=$(curl -sS -X POST "$API_BASE_URL/memory/runtime/turn" \
  -H "x-user-id: $USER_ID" \
  -H "Content-Type: application/json" \
  -d "{\"scopeId\":\"$scope_id\",\"message\":\"What is the current architecture goal?\",\"source\":\"sdk\",\"writeTier\":\"ephemeral\",\"digestMode\":\"skip\"}")

fast_plan_mode=$(printf "%s" "$layer_status_json" | jq -r '.retrievalPlan.mode')
answer_mode=$(printf "%s" "$runtime_json" | jq -r '.answerMode')
runtime_plan_mode=$(printf "%s" "$runtime_json" | jq -r '.retrievalPlan.mode')
runtime_goal_aligned=$(printf "%s" "$runtime_json" | jq -r '.layerAlignment.goalAligned')
runtime_warning_count=$(printf "%s" "$runtime_json" | jq -r '.warnings | length')
working_goal=$(printf "%s" "$working_state_json" | jq -r '.view.goal')
stable_goal=$(printf "%s" "$stable_state_json" | jq -r '.view.goal')
goal_aligned=$(printf "%s" "$layer_status_json" | jq -r '.layerAlignment.goalAligned')
layer_warning_count=$(printf "%s" "$layer_status_json" | jq -r '.warnings | length')
working_memory_caught_up=$(printf "%s" "$layer_status_json" | jq -r '.freshness.workingMemoryCaughtUp')
stable_state_caught_up=$(printf "%s" "$layer_status_json" | jq -r '.freshness.stableStateCaughtUp')

if [[ "${fast_plan_mode}" == "null" || -z "${fast_plan_mode}" ]]; then
  echo "layer-status retrievalPlan missing" >&2
  echo "$layer_status_json"
  exit 1
fi

if [[ "${answer_mode}" == "null" || -z "${answer_mode}" ]]; then
  echo "runtime answerMode missing" >&2
  echo "$runtime_json"
  exit 1
fi

if [[ "${runtime_plan_mode}" == "null" || -z "${runtime_plan_mode}" ]]; then
  echo "runtime retrievalPlan missing" >&2
  echo "$runtime_json"
  exit 1
fi

if [[ "${runtime_goal_aligned}" != "true" ]]; then
  echo "runtime layerAlignment missing or false" >&2
  echo "$runtime_json"
  exit 1
fi

if [[ "${runtime_warning_count}" != "0" ]]; then
  echo "runtime returned warnings for the clean smoke scope" >&2
  echo "$runtime_json"
  exit 1
fi

if [[ "${working_version}" == "null" || -z "${working_version}" || "${working_version}" == "0" ]]; then
  echo "working-state version missing or zero" >&2
  echo "$working_state_json"
  exit 1
fi

if [[ "${working_goal}" == "null" || -z "${working_goal}" ]]; then
  echo "working-state goal missing" >&2
  echo "$working_state_json"
  exit 1
fi

if [[ "${stable_goal}" == "null" || -z "${stable_goal}" ]]; then
  if [[ "${stable_digest_id:-null}" == "null" || -z "${stable_digest_id:-}" ]]; then
    echo "stable-state digest not ready before timeout; ensure api and worker are running" >&2
  else
    echo "stable-state goal missing" >&2
  fi
  echo "$stable_state_json"
  exit 1
fi

if [[ "${stable_digest_id:-null}" == "null" || -z "${stable_digest_id:-}" ]]; then
  echo "stable-state digest missing" >&2
  echo "$stable_state_json"
  exit 1
fi

if [[ "${goal_aligned}" != "true" ]]; then
  echo "layer-status goal alignment failed" >&2
  echo "$layer_status_json"
  exit 1
fi

if [[ "${layer_warning_count}" != "0" ]]; then
  echo "layer-status returned warnings for the clean smoke scope" >&2
  echo "$layer_status_json"
  exit 1
fi

if [[ "${working_memory_caught_up}" != "true" ]]; then
  echo "working memory freshness check failed" >&2
  echo "$layer_status_json"
  exit 1
fi

if [[ "${stable_state_caught_up}" != "true" ]]; then
  echo "stable-state freshness check failed" >&2
  echo "$layer_status_json"
  exit 1
fi

echo "Runtime smoke passed."
echo "Scope: $scope_id"
echo "Working state:"
printf "%s" "$working_state_json" | jq '{version, view}'
echo "Stable state:"
printf "%s" "$stable_state_json" | jq '{digestId, view}'
echo "Layer status:"
printf "%s" "$layer_status_json" | jq '{retrievalPlan, fastLayerSummary, layerAlignment, freshness}'
printf "%s" "$layer_status_json" | jq '{warnings}'
echo "Runtime turn:"
printf "%s" "$runtime_json" | jq '{answer, answerMode, retrievalPlan, layerAlignment, warnings, notes}'

echo "Doctor:"
if [[ -n "${DOCTOR_OUTPUT_PATH:-}" ]]; then
  doctor_output_path="${DOCTOR_OUTPUT_PATH}"
  if [[ "${doctor_output_path}" != /* ]]; then
    doctor_output_path="${ROOT_DIR}/${doctor_output_path}"
  fi
  STATECORE_CLI_USER_ID="$USER_ID" pnpm dev:cli -- doctor --probe-turn --assert-clean --message "What is the current architecture goal?" --output-file "$doctor_output_path"
else
  STATECORE_CLI_USER_ID="$USER_ID" pnpm dev:cli -- doctor --probe-turn --assert-clean --message "What is the current architecture goal?"
fi
