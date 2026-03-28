# StateCore v1.0.0 Release Summary

This summary captures the validation snapshot used to release StateCore as a self-hosted long-term memory engine.

## Validation Snapshot

- Release verification: `pnpm release:verify` passed
- Main benchmark:
  - artifact: `artifacts/releases/v1.0.0/benchmark-2026-03-19T21-38-17-892Z.json`
  - overall: `81.2`
  - long-term memory reliability: `100`
  - digest repeatability: `1`
  - digest omission warning rate: `0`
  - replay state match: `true`
  - rebuild consistency rate: `1`
  - transition taxonomy match rate: `1`
  - grounded response evidence coverage: `1`
- Drift benchmark:
  - artifact: `artifacts/releases/v1.0.0/drift-2026-03-19T21-31-01-938Z.json`
  - avg recall: `1`
  - goal drift rate: `0`
  - constraint drift rate: `0`
  - decision drift rate: `0`
  - todo drift rate: `0`
  - digest drift rate: `0`
  - contradiction and omission taxonomy: `0`
- Ablation matrix:
  - artifact: `artifacts/releases/v1.0.0/ablation-2026-03-19T22-35-53-185Z.json`
  - baseline reliability: `100`
  - baseline digest repeatability: `1`
  - baseline digest omission warning rate: `0`
  - baseline replay transition taxonomy match rate: `1`
  - baseline state fact retention rate: `1`
  - baseline open-question continuity rate: `1`
  - baseline risk continuity rate: `1`

## Release Claim

StateCore v1.0.0 is ready to ship as a self-hosted, developer-facing long-term memory engine.

The release claim is backed by three properties that now hold simultaneously on the release validation path:

- Replayable memory state
  - rebuilding from the same history reproduces the same protected state and transition taxonomy
- Low-drift memory consolidation
  - digest generation preserves goals, constraints, decisions, and todos without omission or contradiction in the release drift fixture
- Grounded assistant behavior
  - runtime turns and grounded answers return structured evidence with digest, event, and state support

## Remaining Scope

The project still has room to improve beyond v1.0.0, but the remaining work is no longer release-blocking:

- deeper retrieval experiments beyond heuristic-first plus optional embedding rerank
- richer assistant session boundaries and runtime ergonomics
- broader benchmark fixture coverage and more public result snapshots
