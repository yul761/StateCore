# Observable Comparison

This repository now includes a side-by-side drift demo intended for humans, not just benchmark tables.

It runs the same event sequence through:

- Project Memory
- a direct-model baseline that keeps only one rolling summary

The direct-model baseline is deliberately simple because it mirrors the common pattern that causes visible drift:

- keep a running summary
- overwrite that summary over time
- answer from the summary later

Project Memory uses the normal control path instead:

- ingest events
- build digest state
- answer from retrieved memory plus protected state

## What It Produces

The script writes a markdown report that shows:

- the total number of rounds and the total number of questions evaluated
- the round number and checkpoint in the sequence
- the exact input events introduced in that round
- the direct model's rolling summary at that point, split into goal / constraints / decisions / todos / status / noise
- the same question asked to both systems
- required facts each answer should include
- explicit alternate phrasings when a check accepts more than one wording for the same fact
- whether the answer needed one specific phrase or all of several facts
- stale or contradictory facts each answer should avoid
- pass/fail verdicts for both sides

This makes drift observable in plain language, not just as a score.

## Run

Prerequisites:

- API running
- Worker running
- `FEATURE_LLM=true`
- `MODEL_*` or compatible `OPENAI_*` variables configured

Command:

```bash
node scripts/benchmark/run-visible-comparison.mjs
```

Or with an explicit fixture:

```bash
VISIBLE_COMPARE_FIXTURE=benchmark-fixtures/observable-drift-demo.json node scripts/benchmark/run-visible-comparison.mjs
```

If you want the runner to fail fast on one stuck HTTP or model request:

```bash
VISIBLE_COMPARE_REQUEST_TIMEOUT_MS=15000 pnpm benchmark:visible
```

Output files:

- `benchmark-results/visible-comparison-*.json`
- `benchmark-results/visible-comparison-*.md`

The runner now writes partial JSON and markdown output while it is still in progress.
If a checkpoint fails, the artifact keeps the completed rounds and marks the report
status as `failed` with the last error.

Rule checks are intentionally lightweight. They are still string-based, but they now
support explicit alternative phrasings per requirement so the report does not mark a
human-obvious paraphrase as a failure.

## Why This Demo Is Useful

The existing drift runner already gives quantitative drift rates.
This comparison adds the qualitative view people usually ask for:

- "What did the system actually answer?"
- "Did it keep the latest goal?"
- "Did it mix old and new directions?"
- "Did it lose constraints or todos?"

That is easier to understand than aggregate recall alone.
