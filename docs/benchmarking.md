# Benchmarking

Project Memory includes a reproducible benchmark runner for research-facing claims (latency, throughput, reliability, digest consistency).

## Run

Prerequisites:
- API running
- Worker running
- Postgres + Redis running

Command:
```bash
pnpm benchmark
```

Reproducible run (fixed seed + fixture):
```bash
BENCH_SEED=42 BENCH_FIXTURE=benchmark-fixtures/basic.json pnpm benchmark
```

Generate additional fixtures:
```bash
node scripts/benchmark/generate-fixtures.mjs
```

Fixture files may include explicit `gold` labels for:
- `goal`
- `constraints`
- `decisions`
- `todos`

Drift benchmarks will prefer these labels when present and fall back to parsing event text otherwise.
Drift reports include per-category omission and contradiction taxonomy summaries when gold labels are available.

Run ablations (controlled variable sweeps):
```bash
node scripts/benchmark/run-ablations.mjs
```

The ablation matrix now includes both digest-control variables and assistant runtime policy profiles.
When comparing ablations, prefer reporting `Long-term Memory Reliability` and runtime metrics alongside the overall score.
See `docs/runtime-profile-ablation-guide.md` for a runtime-focused interpretation guide.

Run drift test (50 rounds default):
```bash
DRIFT_RUNS=50 DRIFT_FIXTURE=benchmark-fixtures/decision-heavy.json node scripts/benchmark/run-drift.mjs
```

Contradiction-injection drift test:
```bash
DRIFT_RUNS=25 DRIFT_FIXTURE=benchmark-fixtures/contradiction-injected.json node scripts/benchmark/run-drift.mjs
```

Goal-evolution drift test:
```bash
DRIFT_RUNS=25 DRIFT_FIXTURE=benchmark-fixtures/goal-evolution.json node scripts/benchmark/run-drift.mjs
```

Document-heavy runtime benchmark:
```bash
BENCH_FIXTURE=benchmark-fixtures/document-heavy.json BENCH_RUNTIME_POLICY_PROFILE=document-heavy pnpm benchmark
```

Replay consistency check:
```bash
REPLAY_FIXTURE=benchmark-fixtures/basic.json node scripts/benchmark/run-replay-check.mjs
```

Replay reports include category-level state diffs for:
- `goal`
- `constraints`
- `decisions`
- `todos`
- `volatileContext`
- `evidenceRefs`
- `openQuestions`
- `risks`
- `workingContext`

Outputs are written to `benchmark-results/`:
- `benchmark-*.json`
- `benchmark-*.md`

## What It Measures

1. Ingest
- event throughput (events/s)
- p50/p95 latency
- success/failure counts

2. Retrieve
- p50/p95 latency
- semantic hit rate (concept + alias grounded check)
- strict hit rate (exact keyword check)

3. Digest (when `FEATURE_LLM=true`)
- success rate
- average end-to-end latency
- consistency pass rate (summary/changes/nextSteps constraints)
- failure taxonomy histogram for digest benchmark runs
- persisted consistency taxonomy histogram from accepted digest snapshots
- gold-backed retention and contradiction summary when fixture labels are available

4. Reminder
- due-to-sent latency
- delivery success

5. Replay
- rebuild snapshot count
- full-state equivalence check
- category-level mismatch report for protected state and evidence context

6. Assistant runtime
- turn success rate
- average turn latency
- evidence coverage rate
- digest trigger rate
- observed write-tier distribution
- policy profile used by the run
- runtime decision-note taxonomy

## Scoring Model (0-100)

Weighted score:
- LLM enabled: ingest 30%, retrieve 20%, digest 30%, reminder 20%
- LLM disabled: ingest 45%, retrieve 35%, reminder 20%

Each component score is derived from thresholds on latency/success/hit-rate.

The benchmark also emits a separate `Long-term Memory Reliability` score.
This memory-first score is distinct from the overall performance score and combines:

- digest consistency
- gold-backed retention
- contradiction penalties
- replay consistency
- runtime evidence coverage and runtime turn success

## Profiles And Tuning

`BENCH_PROFILE` presets:
- `quick`: fast smoke benchmark
- `balanced` (default): stable local comparison
- `stress`: higher load for saturation checks

Env values still override profile defaults.

## Tuning via Env

- `BENCH_PROFILE` (default balanced)
- `BENCH_EVENTS` (profile default)
- `BENCH_INGEST_CONCURRENCY` (profile default)
- `BENCH_RETRIEVE_QUERIES` (profile default)
- `BENCH_RUNTIME_RUNS` (profile default)
- `BENCH_RUNTIME_POLICY_PROFILE` (default `default`)
- `BENCH_DIGEST_RUNS` (profile default)
- `BENCH_TIMEOUT_MS` (default 180000)
- `BENCH_USER_ID` (default benchmark-user)
- `BENCH_OUTPUT_DIR` (default benchmark-results)
- `BENCH_SEED` (default 42)
- `BENCH_FIXTURE` (path to JSON fixture; optional)

## Reproducibility Protocol

To compare results across machines:
1. Use a fixed `BENCH_SEED`.
2. Use the same `BENCH_FIXTURE` file (or none).
3. Keep the same `BENCH_PROFILE` or explicit env overrides.
4. Report the generated JSON with config metadata.

## Interpreting Results

For external sharing, focus on:
- p95 ingest latency
- retrieve hit rate + p95
- digest consistency pass rate
- reminder delay distribution
- overall score trend across commits

Use the same benchmark config across runs to keep comparisons fair.
