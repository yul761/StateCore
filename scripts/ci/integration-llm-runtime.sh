#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"

API_LOG="${ROOT_DIR}/.tmp-api.log"
WORKER_LOG="${ROOT_DIR}/.tmp-worker.log"
DOCTOR_OUTPUT="${ROOT_DIR}/runtime-doctor.json"

cleanup() {
  if [[ -n "${API_PID:-}" ]]; then kill "$API_PID" >/dev/null 2>&1 || true; fi
  if [[ -n "${WORKER_PID:-}" ]]; then kill "$WORKER_PID" >/dev/null 2>&1 || true; fi
}
trap cleanup EXIT

pnpm db:generate
pnpm db:deploy

pnpm --filter @project-memory/api start >"$API_LOG" 2>&1 &
API_PID=$!
pnpm --filter @project-memory/worker start >"$WORKER_LOG" 2>&1 &
WORKER_PID=$!

for i in {1..40}; do
  if curl -fsS "${API_BASE_URL:-http://localhost:3000}/health" -H "x-user-id: runtime-ci-user" >/dev/null 2>&1; then
    break
  fi
  sleep 1
  if [[ "$i" -eq 40 ]]; then
    echo "API failed to start"
    tail -n 200 "$API_LOG" || true
    tail -n 200 "$WORKER_LOG" || true
    exit 1
  fi
done

pnpm smoke:llm
DOCTOR_OUTPUT_PATH="$DOCTOR_OUTPUT" pnpm smoke:runtime

if [[ ! -f "$DOCTOR_OUTPUT" ]]; then
  echo "Runtime doctor output missing"
  exit 1
fi

echo "Integration smoke passed (LLM runtime)."
