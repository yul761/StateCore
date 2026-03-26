# API Primitives

All endpoints require an identity header:
- `x-user-id` for developer/self-host
- `x-telegram-user-id` for adapter usage

Server stores a normalized `identity` per user (e.g. `user:...`, `local:...`, `telegram:...`), while `telegramUserId` is reserved for raw Telegram IDs used by reminder delivery.

## Ingest
- **POST /memory/events**
  - body: `{ scopeId, type: 'stream'|'document', source?, key?, content }`
  - `document` requires `key` (upsert by key)

## Digest
- **POST /memory/digest**
  - body: `{ scopeId }` (enqueue job)
- requires `FEATURE_LLM=true` and model provider configuration via `MODEL_*` or legacy `OPENAI_*`
- returns actionable error when disabled
- **POST /memory/digest/rebuild**
  - body: `{ scopeId, from?, to?, strategy?: 'full'|'since_last_good' }`
  - enqueues `rebuild_digest_chain`
  - returns `{ jobId, rebuildGroupId }`
- **GET /memory/digests?scopeId=&limit=&cursor=&rebuildGroupId=**
- **GET /memory/state?scopeId=**
  - returns latest `DigestStateSnapshot` for replay/audit use
  - includes `consistency: { ok, errors, warnings } | null`
- **GET /memory/stable-state?scopeId=**
  - returns latest authoritative State Layer snapshot plus compiled State Layer view
- **GET /memory/working-state?scopeId=**
  - returns latest Working Memory snapshot plus compiled Working Memory view
- **GET /memory/fast-view?scopeId=&message=**
  - returns compiled Fast Layer context for inspection/debug
  - also returns `retrievalPlan` so you can see whether the runtime selected `none`, `light`, or `full` recall
- **GET /memory/layer-status?scopeId=&message=**
  - returns a single inspectable three-layer diagnostic snapshot
  - includes:
    - `workingMemoryVersion`
    - `stableStateVersion`
    - `workingMemoryView`
    - `stableStateView`
    - `fastLayerSummary`
    - `retrievalPlan`
    - `layerAlignment`
    - `freshness`
    - `warnings`
- **GET /memory/state/history?scopeId=&limit=&rebuildGroupId=**
  - returns recent `DigestStateSnapshot` items for replay/audit use
  - each item includes `consistency: { ok, errors, warnings } | null`

## Retrieve
- **POST /memory/retrieve**
  - body: `{ scopeId, query, limit? }`
  - returns last digest + recent events
  - `retrieval` metadata now includes:
    - `mode`: `heuristic` or `hybrid`
    - `embeddingRequested` / `embeddingConfigured`
    - `candidateCount` / `returnedCount`
    - `matches[]` with `sourceType`, scores, and `rankingReason`
  - hybrid mode keeps heuristic candidate selection and only reranks the shortlist when an embedding provider role is configured

## Answer (LLM optional)
- **POST /memory/answer**
  - body: `{ scopeId, question }`
  - requires `FEATURE_LLM=true` (otherwise 400)
  - returns `{ answer, evidence? }`
  - `evidence` mirrors the runtime grounding shape:
    - digest ids and summary
    - event snippets with retrieval ranking metadata
    - latest state summary/details when a digest snapshot exists
  - answer and runtime grounding now share the same evidence-building semantics, so fields stay aligned across both endpoints
- **POST /memory/runtime/turn**
  - body: `{ scopeId, message, source?, policyProfile?, policyOverrides?, writeTier?, documentKey?, digestMode?, metadata? }`
  - runs the assistant runtime session flow
  - returns `{ answer, answerMode, writeTier, digestTriggered, workingMemoryVersion?, stableStateVersion?, usedFastLayerContextSummary?, retrievalPlan?, layerAlignment?, warnings?, notes?, evidence }`
  - `evidence` now includes both ids and lightweight summaries/snippets
  - `evidence.eventSnippets` now also carries retrieval ranking metadata when available (`sourceType`, scores, `rankingReason`)
  - `evidence.stateSummary` is derived from the latest digest state snapshot when available, not just a snapshot id placeholder
  - `evidence.stateDetails` includes structured state grounding for the latest snapshot, including provenance fields, transition taxonomy, and recent changes when available
  - `answerMode` is:
    - `direct_state_fast_path` when the runtime can answer directly from state or retrieved structured events
    - `llm_fast_path` when the runtime still needs model generation
  - `retrievalPlan` exposes the selected recall strategy:
    - `none`
    - `light`
    - `full`
  - `layerAlignment` exposes the runtime's view of current cross-layer health for this turn
  - `warnings` surfaces suspicious issues detected in the layer views used by the turn
  - requires `FEATURE_LLM=true`
  - reference CLI usage:
    - `pm turn "goal: ship a self-hosted runtime" --policy-profile conservative --write-tier stable --digest-mode force --recall-limit 8`

## Product Smoke

For a quick end-to-end runtime validation with inspectable layer metadata:

```bash
pnpm smoke:runtime
```

That smoke checks:

- `POST /memory/digest`
- `GET /memory/working-state`
- `GET /memory/stable-state`
- `GET /memory/layer-status`
- scope creation
- event ingestion
- `POST /memory/runtime/turn`
- presence of `retrievalPlan` and `answerMode`
- runtime `layerAlignment.goalAligned`
- `freshness.workingMemoryCaughtUp`
- `freshness.stableStateCaughtUp`
- empty runtime `warnings` for a clean smoke scope
- `layerAlignment.goalAligned`
- empty `warnings` for a clean smoke scope

For a broader local product verification pass:

```bash
pnpm smoke
```

For GitHub-hosted LLM runtime verification, the repository also includes a manual
`Runtime Smoke` workflow under `.github/workflows/runtime-smoke.yml`.

For a quick local diagnosis of runtime configuration, active scope, layer versions,
and fast-view retrieval planning:

```bash
pnpm dev:cli -- layer-status
pnpm dev:cli -- doctor
```

For the same diagnosis plus a real runtime probe with latency, `answerMode`, and
`retrievalPlan`:

```bash
pnpm dev:cli -- doctor --probe-turn
```

For a pass/fail assertion over the same diagnostics:

```bash
pnpm dev:cli -- doctor --probe-turn --assert-clean
```

For CI or automation, pin the CLI to a known user id so it reads the intended scope:

```bash
PROJECT_MEMORY_CLI_USER_ID=runtime-ci-user pnpm dev:cli -- doctor --probe-turn --assert-clean
```

To persist the diagnosis as a JSON artifact:

```bash
PROJECT_MEMORY_CLI_USER_ID=runtime-ci-user pnpm dev:cli -- doctor --probe-turn --assert-clean --output-file runtime-doctor.json
```

When you run that command from the repo root, `runtime-doctor.json` is written
relative to the invocation directory, so local smoke and CI can pick it up
directly from the repository root.

The `doctor` summary now reads from `GET /memory/layer-status` and includes `layerAlignment`, which reports:

- whether Working Memory and Stable State agree on the current goal
- how many constraints overlap
- how many decisions overlap
- whether the scope looks ready for direct-state fast-path reads
- whether the diagnostics see suspicious issues such as structured-field leakage in the goal

`layer-status.freshness` reports:

- the timestamp of the latest ingested event
- the latest Working Memory update time
- the latest Stable State creation time
- lag in milliseconds from the event stream to each layer
- whether each layer is currently considered caught up

`doctor --assert-clean` exits non-zero when:

- the API is not healthy
- `FEATURE_LLM` is off
- there is no diagnosed scope
- `layerAlignment.goalAligned` is false
- `layerAlignment.fastPathReady` is false
- Working Memory is not caught up
- Stable State is not caught up
- layer warnings are present
- the runtime probe returns warnings or missing answer metadata

The manual `Runtime Smoke` GitHub workflow now uploads `runtime-doctor.json` as an artifact.

## Scopes
- **POST /scopes**
- **GET /scopes**
- **POST /scopes/:id/active**
- **GET /state**

## Reminders
- **POST /reminders**
- **GET /reminders?status=&limit=&cursor=**
- **POST /reminders/:id/cancel**

## Health
- **GET /health**
  - returns `status`
  - also exposes:
    - active Working Memory config
    - active retrieval config
    - model-role names for benchmark/reproducibility tooling

## Example (curl)
```bash
curl -X POST "$API_BASE_URL/scopes" \
  -H 'x-user-id: dev-user' \
  -H 'Content-Type: application/json' \
  -d '{"name":"Demo"}'

curl -X POST "$API_BASE_URL/memory/events" \
  -H 'x-user-id: dev-user' \
  -H 'Content-Type: application/json' \
  -d '{"scopeId":"<scopeId>","type":"stream","content":"First note"}'
```
