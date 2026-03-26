#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"

API_LOG="${ROOT_DIR}/.tmp-api.log"
WORKER_LOG="${ROOT_DIR}/.tmp-worker.log"
DOCTOR_OUTPUT="${ROOT_DIR}/runtime-doctor.json"
BENCH_ARTIFACT="${ROOT_DIR}/runtime-benchmark.json"
DRIFT_ARTIFACT="${ROOT_DIR}/runtime-drift.json"
SUMMARY_JSON="${ROOT_DIR}/runtime-readiness-summary.json"
SUMMARY_MD="${ROOT_DIR}/runtime-readiness-summary.md"

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

for i in {1..60}; do
  if curl -fsS "${API_BASE_URL:-http://localhost:3000}/health" -H "x-user-id: runtime-ci-user" >/dev/null 2>&1; then
    break
  fi
  sleep 1
  if [[ "$i" -eq 60 ]]; then
    echo "API failed to start"
    tail -n 200 "$API_LOG" || true
    tail -n 200 "$WORKER_LOG" || true
    exit 1
  fi
done

DOCTOR_OUTPUT_PATH="$DOCTOR_OUTPUT" pnpm smoke:runtime

BENCH_OUTPUT_DIR=".tmp-benchmark-results" \
BENCH_FIXTURE=benchmark-fixtures/three-layer-session.json \
BENCH_PROFILE=quick \
BENCH_RUNTIME_RUNS=1 \
BENCH_DIGEST_RUNS=1 \
BENCH_RETRIEVE_QUERIES=2 \
BENCH_REPLAY_RUNS=1 \
BENCH_TIMEOUT_MS=60000 \
BENCH_REQUEST_TIMEOUT_MS=15000 \
pnpm benchmark

latest_bench="$(ls -t .tmp-benchmark-results/benchmark-*.json | head -n 1)"
cp "$latest_bench" "$BENCH_ARTIFACT"

DRIFT_OUTPUT_DIR=".tmp-benchmark-results" \
DRIFT_RUNS=5 \
DRIFT_REQUEST_TIMEOUT_MS=15000 \
DRIFT_FIXTURE=benchmark-fixtures/goal-evolution.json \
node scripts/benchmark/run-drift.mjs

latest_drift="$(ls -t .tmp-benchmark-results/drift-*.json | head -n 1)"
cp "$latest_drift" "$DRIFT_ARTIFACT"

node scripts/ci/summarize-runtime-readiness.mjs \
  "$DOCTOR_OUTPUT" \
  "$BENCH_ARTIFACT" \
  "$DRIFT_ARTIFACT" \
  "$SUMMARY_JSON" \
  "$SUMMARY_MD"

node <<'EOF'
const fs = require('fs');
const bench = JSON.parse(fs.readFileSync('runtime-benchmark.json', 'utf8'));
const drift = JSON.parse(fs.readFileSync('runtime-drift.json', 'utf8'));

const runtime = bench.metrics?.runtime || {};
const summary = drift.summary || {};
const failures = [];

if ((runtime.success || 0) < 1) failures.push('runtime_success');
if ((runtime.directStateFastPathRate || 0) < 1) failures.push('direct_state_fast_path_rate');
if ((runtime.layerStatusWorkingMemoryCaughtUpRate || 0) < 1) failures.push('working_memory_caught_up');
if ((runtime.layerStatusStableStateCaughtUpRate || 0) < 1) failures.push('stable_state_caught_up');
if ((runtime.runtimeLayerStatusConsistencyRate || 0) < 1) failures.push('runtime_layer_status_consistency');
if ((summary.success || 0) !== (summary.runs || 0)) failures.push('drift_success');
if ((summary.digestDriftRate || 0) > 0) failures.push('digest_drift_rate');
if ((summary.goalDriftRate || 0) > 0) failures.push('goal_drift_rate');
if ((summary.constraintDriftRate || 0) > 0) failures.push('constraint_drift_rate');
if ((summary.decisionDriftRate || 0) > 0) failures.push('decision_drift_rate');
if ((summary.todoDriftRate || 0) > 0) failures.push('todo_drift_rate');

if (failures.length) {
  console.error('Runtime readiness failed:', failures.join(', '));
  process.exit(1);
}

console.log('Runtime readiness passed.');
EOF
