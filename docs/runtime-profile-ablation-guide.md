# Runtime Profile Ablation Guide

This guide describes how to run and interpret ablations focused on assistant runtime policy profiles.

The goal is to compare how runtime behavior changes under:

- `default`
- `conservative`
- `document-heavy`

And, when needed, under targeted override variants such as:

- conservative + `promoteLongFormToDocumented`
- default + `digestOnCandidate`
- reduced `recallLimit`

These profile comparisons are intentionally treated as first-class research artifacts, not as incidental API behavior.

## Why This Matters

Long-term memory quality is not only determined by digest generation.

It is also determined by what enters memory in the first place and when digesting is triggered.

Two systems can share the same digest pipeline but diverge substantially because their runtime policies:

- promote different messages into memory
- choose different write tiers
- preserve or discard long-form updates differently
- trigger digesting at different times

That is why runtime policy profile ablations belong in the evaluation story.

## Recommended Fixture Set

Use at least these fixtures:

- `benchmark-fixtures/basic.json`
- `benchmark-fixtures/goal-evolution.json`
- `benchmark-fixtures/document-heavy.json`

Recommended interpretation:

- `basic.json` checks whether profiles differ on ordinary mixed memory traffic
- `goal-evolution.json` checks whether profiles preserve current truth after state evolution
- `document-heavy.json` checks whether profiles handle long-form memory in a controlled way

## Recommended Commands

Single benchmark runs:

```bash
BENCH_FIXTURE=benchmark-fixtures/basic.json BENCH_RUNTIME_POLICY_PROFILE=default pnpm benchmark
BENCH_FIXTURE=benchmark-fixtures/basic.json BENCH_RUNTIME_POLICY_PROFILE=conservative pnpm benchmark
BENCH_FIXTURE=benchmark-fixtures/document-heavy.json BENCH_RUNTIME_POLICY_PROFILE=document-heavy pnpm benchmark
```

Ablation sweep:

```bash
BENCH_FIXTURE=benchmark-fixtures/document-heavy.json node scripts/benchmark/run-ablations.mjs
```

Override-focused benchmark:

```bash
BENCH_FIXTURE=benchmark-fixtures/document-heavy.json \
BENCH_RUNTIME_POLICY_PROFILE=conservative \
BENCH_RUNTIME_PROMOTE_LONG_FORM=true \
BENCH_RUNTIME_RECALL_LIMIT=8 \
pnpm benchmark
```

## What To Compare

Do not compare only the overall score.

Prefer comparing:

- `Long-term Memory Reliability`
- digest omission warning rate
- temporary todo intrusion rate when todo-heavy fixtures are used
- state-backed retention metrics, not only digest-text retention
- latest-document retention and superseded-document intrusion when comparing document-focused fixtures
- runtime turn success
- runtime evidence coverage rate
- runtime digest-summary / event-snippet / ranking-reason / event-score / state-summary evidence rates
- runtime digest trigger rate
- runtime write-tier distribution
- runtime decision-note taxonomy
- runtime override settings used in each run
- digest contradiction and omission indicators
- replay consistency

## Expected Behavioral Differences

These are hypotheses, not guaranteed outcomes:

- `default`
  - balanced write behavior
  - moderate digest triggering
  - moderate evidence density

- `conservative`
  - fewer stable promotions
  - fewer digest triggers
  - lower noise in memory, but possible omission risk

- `document-heavy`
  - more documented writes
  - more digest triggering for content-rich turns
  - stronger preservation of long-form context, but possible verbosity or drift pressure

## Reporting Template

When publishing a runtime profile comparison, include:

1. Fixture and benchmark configuration
2. Profile names compared
3. Reliability deltas between profiles
4. Runtime taxonomy differences
5. Replay differences, if any
6. Interpretation of trade-offs

Prefer phrasing these comparisons relative to the `baseline` case instead of listing isolated scores. The generated ablation summary now includes:

- best reliability delta versus baseline
- best omission warning delta versus baseline
- worst omission warning delta versus baseline
- worst reliability delta versus baseline
- best runtime evidence coverage delta versus baseline
- worst runtime evidence coverage delta versus baseline

## Suggested Research Questions

- Which runtime profile best preserves reliability under long-form document updates?
- Does a conservative profile reduce contradiction at the cost of recall?
- Does a document-heavy profile improve retention while increasing replay divergence?
- How much of reliability variation comes from runtime policy versus digest-control parameters?
- Which override changes runtime evidence density without materially improving reliability?
