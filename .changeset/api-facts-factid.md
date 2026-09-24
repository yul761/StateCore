---
"@statecore/api": minor
"@statecore/contracts": minor
"@statecore/core": minor
---

`GET /v1/memory/facts` items carry an additive-optional `factId` — the fact-registry evidence-chain id for that item, or `null` when unmatched (contract `1.7.0`). `attachFactIds`, previously local to `apps/mcp`, is now exported from `@statecore/core` so both the API and the embedded MCP backend join the same id from a single implementation.
