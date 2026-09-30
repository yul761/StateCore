---
"@statecore/api": minor
"@statecore/contracts": minor
---

`GET /v1/memory/facts/:factId/provenance` gains an optional `evidence` array (contract 1.8.0): the source text and time of each evidence event behind the chain, so a caller can show "you said this" without a second lookup. Forgotten (suppressed) evidence is omitted; text is capped at 2000 characters.
