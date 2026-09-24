---
"statecore-mcp": minor
---

Keyless usage is now visible instead of silent. `remember` reports its distillation state (`scheduled` or `deferred`, with a reason when deferred); `facts` includes a top-level `pending` count of events not yet folded into stable facts. A new `statecore-mcp digest` subcommand runs one explicit distillation pass now — `{ ran: true }`, or `{ ran: false, reason }` (`no-llm`, `below-threshold`, `locked`, `failed`) when it does not. The embedded backend gains `pendingEvents()` to back the `facts` count. `--url` mode's `facts()` output now carries `factId` per item when the server is on contract 1.7.0 or later (a pass-through; an older server simply omits the field).
