# Changelog

All notable changes to this project are documented in this file.

The format loosely follows Keep a Changelog and Semantic Versioning.

## [Unreleased]

## [1.0.0] - 2026-03-18

### Added
- Assistant runtime turn flow with policy profiles, overrides, structured evidence, and grounded answer evidence.
- Provider-neutral model configuration with role-specific chat, structured-output, and embedding endpoints.
- Configurable model timeout support via `MODEL_TIMEOUT_MS` for slower digest and benchmark workloads.
- Replay consistency analysis with transition taxonomy and confidence-aware state diffs.
- Working-note continuity benchmarking, including open-question and risk retention / intrusion metrics.
- Release verification command (`pnpm release:verify`) and v1.0.0 release notes draft.

### Improved
- Protected-state evolution for goals, constraints, decisions, todos, questions, risks, and volatile context.
- Durable numbered decision and todo retention across digest selection, state merge, and drift evaluation.
- Long-term memory reliability scoring with replay stability, grounded response quality, and state-confidence signals.
- Benchmark, ablation, trend, and research-report outputs for working-note continuity and replay explainability.

### Docs
- Vision, drift, digest state, assistant runtime, evaluation, provider abstraction, and benchmarking docs now reflect the memory-first 1.0.0 positioning.

## [0.1.0] - 2026-02-04

### Added
- Benchmark suite and comparison reporting (`benchmark-results/compare-all.md`).
- Digest control pipeline (selection, delta detection, state protection, consistency checks, retries).
- Digest rebuild endpoint and worker flow.
- OSS governance docs (`CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `SECURITY.md`).
- GitHub templates and CI workflow.

### Improved
- Query-aware retrieve ranking and answer grounding.
- Benchmark retrieve scoring with semantic + strict hit rates.

### Docs
- Expanded technical and benchmarking docs.
