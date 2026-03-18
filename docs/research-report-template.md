# Research Report Template

## Title
Short descriptive title of the experiment.

## Abstract
1-2 paragraphs summarizing the goal, methods, and main findings.

## Methods
- Environment (OS, hardware, Node, DB, Redis)
- LLM settings (if enabled)
- Benchmark config (seed, fixture, profile, overrides)
- Runtime policy profile (if runtime benchmark is included)

## Results
- Scores (overall + long-term memory reliability + components)
- Key metrics (p95 latencies, hit rates, consistency pass rate, replay match)
- Runtime metrics (turn success, evidence coverage, digest trigger rate, write-tier distribution)
- Trend window deltas when multiple benchmark artifacts are available
- Taxonomy summaries (digest failures, digest consistency, runtime decision notes)
- Observed failures or anomalies

## Discussion
- Interpretation of results
- Trade-offs observed
- Limitations
- Profile-specific behavior differences (if ablations compare runtime policies)

## Reproducibility Artifacts
- Commit hash
- JSON report file
- Fixture file used

The repository also includes `scripts/benchmark/generate-research-report.mjs`, which generates a draft report in this general structure from recent benchmark, ablation, and trend artifacts.
