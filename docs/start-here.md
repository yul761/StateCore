# Start Here

If you are opening this repository for the first time, do not start by reading every doc.

Use this order instead.

## Fastest Proof

Start here if you want to know whether the core claim is real:

- `artifacts/demos/visible-comparison-latest.md`
- `artifacts/demos/visible-comparison-latest.json`

That demo shows the same event sequence evaluated in two ways:

- StateCore
- a direct-model rolling-summary baseline

The current curated sample evaluates:

- 3 rounds
- 7 questions
- StateCore: 7/7
- direct baseline: 4/7

## Fastest Interactive Path

Start here if you want to use the product shape instead of reading benchmark output:

- Public demo: `http://147.182.174.191`
- `docs/demo-quickstart.md`

That path gives you:

- the interactive demo shell
- a scope browser
- a chat UI on the public runtime surface
- visible Fast Layer / Working Memory / State Layer feedback

## Quick Mental Model

If you want the simplest explanation of what this project changes, read:

- `README.md`
- `docs/observable-comparison.md`
- `docs/product-surface.md`
- `docs/demo-web-surface.md`

The short version:

- direct model memory: events -> rolling summary -> answer
- StateCore: events -> selection -> protected state -> digest -> grounded answer

The project is not trying to make one summary prompt better.
It is changing the memory update mechanism itself.

## If You Want To Run It

Use this path:

```bash
docker compose up -d
pnpm install
cp .env.example .env
pnpm db:generate
pnpm db:migrate
pnpm seed
pnpm dev:api
pnpm dev:worker
pnpm benchmark:visible
```

Then open:

- `artifacts/demos/visible-comparison-latest.md`

If you want the repo's broader three-layer benchmark instead of the side-by-side visible demo:

```bash
BENCH_FIXTURE=benchmark-fixtures/three-layer-session.json pnpm benchmark
```

If you want the smallest interactive shell instead of benchmark output:

```bash
pnpm dev:demo-stack
```

Then open:

- `http://147.182.174.191`
- `http://localhost:3100`

For the full setup sequence and the first questions to try, use:

- `docs/demo-quickstart.md`

If you only want the web shell itself because the API and worker are already running:

```bash
pnpm dev:demo
```

To verify that shell is actually bootable against the current API:

```bash
pnpm smoke:demo-web
```

If you want the heavier runtime readiness check used for release-style CI:

```bash
pnpm ci:runtime-readiness
```

That path now leaves behind:

- `runtime-readiness-summary.json`
- `runtime-readiness-summary.md`

If you want the fastest product-facing verification of the runtime itself:

```bash
pnpm smoke:runtime
```

That smoke checks:

- `POST /memory/digest`
- `GET /memory/working-state`
- `GET /memory/stable-state`
- `GET /memory/layer-status`
- `POST /memory/runtime/turn`
- runtime `retrievalPlan`
- runtime `answerMode`
- runtime `layerAlignment.goalAligned`
- `layerAlignment.goalAligned`
- `freshness.workingMemoryCaughtUp`
- `freshness.stableStateCaughtUp`
- no runtime `warnings` for the clean smoke scope
- no diagnostic `warnings` for the clean smoke scope

If you want the full local product smoke instead of just runtime:

```bash
pnpm smoke
```

If you want a quick local diagnosis before doing anything else:

```bash
pnpm dev:cli -- layer-status
pnpm dev:cli -- doctor
```

If you also want a real runtime probe in that diagnosis:

```bash
pnpm dev:cli -- doctor --probe-turn
```

If you want the diagnosis to fail fast when the scope is not clean:

```bash
pnpm dev:cli -- doctor --probe-turn --assert-clean
```

If you are running that in automation, set a stable CLI identity:

```bash
STATECORE_CLI_USER_ID=runtime-ci-user pnpm dev:cli -- doctor --probe-turn --assert-clean
```

If you also want a JSON artifact from that check:

```bash
STATECORE_CLI_USER_ID=runtime-ci-user pnpm dev:cli -- doctor --probe-turn --assert-clean --output-file runtime-doctor.json
```

When you invoke `pnpm dev:cli` from the repo root, `runtime-doctor.json` is written
relative to that directory.

The doctor output also includes `layerAlignment`, so you can quickly see
whether Working Memory and Stable State are converging on the same goal.
It also includes `layerFreshness`, so you can see whether those layers are
actually caught up to the latest event stream.
That diagnosis now comes from a single aggregated endpoint instead of requiring
separate `working-state`, `stable-state`, and `fast-view` calls.

## If You Want The Internals

Read these next:

- `docs/repo-map.md`
- `docs/technical-overview.md`
- `docs/digest-state.md`
- `docs/drift-definition.md`
- `docs/benchmarking.md`
