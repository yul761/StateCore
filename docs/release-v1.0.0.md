# Project Memory v1.0.0

Project Memory v1.0.0 is the first release that clearly centers the project around a self-hosted, developer-facing long-term memory engine rather than a generic chat memory API.

## Highlights

- Memory-first architecture
  - protected `DigestState` with `stableFacts`, `workingNotes`, `todos`, `volatileContext`, `evidenceRefs`, `provenance`, `recentChanges`, and derived `confidence`
  - stronger state-evolution rules for goals, constraints, decisions, todos, questions, risks, and volatile context
  - replayable state snapshots with category-level and transition-level diffing

- Low-drift digest control
  - explicit contradiction and omission taxonomy
  - document-backed supersede rules for durable state
  - semantic reaffirm / remove handling for stream updates
  - working-note resolution paths for answered questions and cleared risks
  - durable stream fact preservation for numbered decisions and todos

- Grounded assistant runtime
  - `POST /memory/runtime/turn`
  - write-tier and digest policy controls
  - policy profiles and per-turn overrides
  - structured evidence with digest summaries, event snippets, ranking reasons, state details, provenance, transition taxonomy, and confidence

- Developer-facing model abstraction
  - provider-neutral `MODEL_*` configuration
  - role-specific chat / structured-output / embedding model settings
  - configurable `MODEL_TIMEOUT_MS` for slower hosted or local model backends
  - optional embedding rerank layered on top of heuristic retrieval

- Research and evaluation story
  - benchmark, drift, replay, ablation, trend, and research-report generators
  - long-term memory reliability score with retention, contradiction control, replay stability, and grounding
  - fixtures for contradiction injection, goal evolution, todo pileups, document version updates, retrieval semantics, document-heavy runtime flows, and working-note resolution

## Release Readiness

- unified release verification command: `pnpm release:verify`
- benchmark and report scripts included in release validation
- changelog, roadmap, release process, and release notes all aligned to the current memory-first positioning
- latest benchmark validation snapshot:
  - replay state match: `true`
  - rebuild consistency rate: `1`
  - transition taxonomy match rate: `1`
  - digest repeatability rate: `1`
  - digest omission warning rate: `0`
- latest drift validation snapshot:
  - avg recall: `1`
  - goal / constraint / decision / todo drift: `0`
  - digest drift rate: `0`
  - contradiction and omission taxonomy: `0`

## Notes

- This is still a self-hosted BYOM runtime, not a hosted product.
- Retrieval remains evidence-first and heuristic-first by default; embedding rerank is optional.
- The next major release should focus on deeper retrieval experiments and more mature runtime/session boundaries rather than broadening product surface area.
