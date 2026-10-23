---
"statecore-mcp": minor
"@statecore/core": minor
"@statecore/worker": patch
"@statecore/api": patch
---

Forgotten notes free their slots, a digest can no longer evict a caller's note, and a digest reports honestly when it did not process everything.

- **Forget frees the slot.** `forget` on a note now drops it from the active notes and retires its registry entry (`retiredReason: "forgotten"`, never deleted), in the same transaction as the ForgottenFact row (embedded and `POST /v1/memory/facts/forget`). Stores written before this heal on their next note write. A full digest no longer re-appends forgotten notes at write time, and the carried-over notes are held to the notes cap. A note evicted at the cap and written again gets a live registry entry again.
- **Events before the first note are digested.** The placeholder digest the first note creates is stamped just before the scope's earliest event, so those events stay pending instead of being skipped.
- **Caller notes are protected from the digest (behaviour change).** Notes written through `remember` / `POST note` are tagged `origin: "note"` (older ones are recognised by shape). A digest-extracted note may evict only the oldest digest-extracted note; when every slot holds a caller note the incoming digest note is dropped and logged as `cap_rejected_incoming`. Digests no longer rewrite caller notes in place or consolidate them.
- **Honest digest outcomes (statecore-mcp).** `digestNow()` / `statecore-mcp digest` return `{ ran: true, partial: true }` (additive) when the written digest skipped stage-2 chunks or the selection budget left pending events out. A stage 2 that produced nothing parseable, a missing scope, or no model provider now report `{ ran: false, reason: "failed" }` and write nothing, leaving the events pending. Core marks skipped chunks as `degraded: { reason: "stage2_chunks_failed", failed, total }`; the worker keeps its existing write-anyway behaviour.
