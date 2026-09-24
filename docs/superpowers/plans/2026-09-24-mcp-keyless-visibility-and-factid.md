# statecore-mcp keyless visibility + `/v1` factId (sub-projects 3 and 4) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the keyless "stored but not distilled" state visible and recoverable (`distillation` on `remember`, `pending` on `facts`, a `digest` CLI), and give `--url` mode the same `factId` per fact item the embedded mode has, via one additive `/v1` field.

**Architecture:** Sub-project 3 is confined to `apps/mcp`: a shared `countPendingEvents(db, scopeId)` feeds both the digest trigger and the new `facts().pending` field; `remember` reports whether background distillation is possible; `statecore-mcp digest` wraps `digestNow()`. Sub-project 4 moves the embedded `attachFactIds` join into `@statecore/core` so the API and the embedded backend share it, adds optional `factId` to `MemoryFactsOutput` items, bumps the contract to 1.7.0, and lets the remote backend pass `factId` through.

**Tech Stack:** TypeScript, `node:sqlite` store, NestJS API (`apps/api`), Zod contracts (`packages/contracts`), Vitest.

**Spec:** `docs/superpowers/specs/2026-09-23-statecore-mcp-1.0-design.md` (sections "Sub-project 3 — keyless visibility" and "Sub-project 4 — `--url` mode `factId`").

## Global Constraints

- `remember({ consolidate: true })` returns `{ ok: true, mode: "event", distillation: "scheduled" | "deferred", reason?: "no model configured" }`. Embedded: `"scheduled"` when a model is usable (`digestLlm` injected, or `FEATURE_LLM=true` with an API key) AND background digest is enabled, else `"deferred"` with the reason. Remote: always `"scheduled"` (the deployment's worker digests). The note path's return shape is unchanged.
- `facts` tool output becomes `{ groups: <the array facts() returns today>, pending?: { events: number, oldest: string } }`; `pending` is present only when the count is non-zero. `MemoryBackend.facts()` keeps returning the array; a new optional `pendingEvents?(): Promise<{ events: number; oldest: string } | null>` supplies the count (embedded only; `oldest` is an ISO timestamp). The spec put `pending` "on the facts output" — the spec is silent on the array-vs-object question, and a JSON array cannot carry a property, so the object wrapper is the conforming shape (Ruling recorded in the ledger).
- "Pending" = stream events in the scope, unsuppressed, newer than the latest digest by `createdAt` OR `ingestedAt` — the exact query `maybeRunDigest` uses today, extracted into `countPendingEvents(db, scopeId): { events: number; oldest: number | null }` in `digest.ts` and reused by it.
- `statecore-mcp digest [--data <dir>] [--scope <name>]` runs `digestNow()` once on an embedded backend (with background digest disabled so only the explicit run happens), prints the `DigestNowResult` as JSON to stdout, exit code 1 only when `reason === "failed"`. `--scope` overrides the scope name (else `resolveScopeName(cwd, env)`).
- `/v1/memory/facts` items gain optional `factId: string` (additive). `apps/api/src/openapi.ts` `info.version` 1.6.0 → 1.7.0; the OpenAPI snapshot is regenerated; `docs/api.md`'s history line gains `1.7.0`. `PublicV1Contracts` needs no new operation (the path already exists), so the surface guard stays green unchanged.
- `attachFactIds` moves to `packages/core/src/memory-facts.ts` as an export with the same signature and behaviour (first-wins factKey → registry id), and `apps/mcp/src/embedded.ts` imports it from `@statecore/core`.
- Commit messages end with:
  ```
  Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01PgCNXpzAbbgv4HYWbxfyUb
  ```
- Worktree branch via `superpowers:using-git-worktrees`. Suites: `pnpm --filter statecore-mcp test`, `pnpm --filter @statecore/api test`, `pnpm --filter @statecore/core test`, `pnpm lint`.

---

## File structure

| Path | Responsibility |
|---|---|
| `apps/mcp/src/digest.ts` (modify) | export `countPendingEvents`; `maybeRunDigest` uses it; export `hasUsableModel(env, digestLlm)`. |
| `apps/mcp/src/backend.ts` (modify) | `remember` return type gains `distillation`/`reason`; new optional `pendingEvents?()`. |
| `apps/mcp/src/embedded.ts` (modify) | `remember` reports distillation; `pendingEvents()`; uses core's `attachFactIds`. |
| `apps/mcp/src/http-backend.ts` (modify) | `remember` reports `"scheduled"`; `facts()` passes `factId` through (no code change needed beyond the comment). |
| `apps/mcp/src/tools.ts` (modify) | `facts` tool returns `{ groups, pending? }`. |
| `apps/mcp/src/cli/digest.ts` (new), `apps/mcp/src/main.ts` (modify) | `digest` subcommand. |
| `packages/core/src/memory-facts.ts` (modify) | `attachFactIds` export. |
| `packages/contracts/src/index.ts` (modify) | `MemoryFactsOutput` item `factId` optional. |
| `apps/api/src/memory-facts.service.ts`, `apps/api/src/openapi.ts`, `apps/api/src/__snapshots__/openapi.test.ts.snap`, `docs/api.md` (modify) | factId population, contract 1.7.0. |
| `apps/mcp/README.md` (modify), `.changeset/mcp-keyless-visibility.md`, `.changeset/api-facts-factid.md` (new) | Docs and release notes. |
| Tests: `apps/mcp/tests/{embedded,digest-trigger,tools,digest-cli,http-backend}.test.ts`, `packages/core/src/memory-facts.test.ts` (or existing core test file for memory-facts), `apps/api/src/memory-facts.service.test.ts` | Coverage. |

---

### Task 1: `countPendingEvents` and `hasUsableModel` in `digest.ts`

**Files:**
- Modify: `apps/mcp/src/digest.ts`
- Test: `apps/mcp/tests/digest-trigger.test.ts` (add cases)

**Interfaces:**
```ts
export function countPendingEvents(db: LiteDb, scopeId: string): { events: number; oldest: number | null }; // oldest = min(createdAt) in ms among pending
export function hasUsableModel(env: NodeJS.ProcessEnv, digestLlm?: DigestChatModel): boolean; // true if digestLlm given, or FEATURE_LLM=true with an effective API key
```

- [ ] **Step 1: Tests** — append to `digest-trigger.test.ts`:

```ts
describe("countPendingEvents", () => {
  it("counts unsuppressed stream events newer than the latest digest and reports the oldest", async () => {
    const dir = mkdtempSync(join(tmpdir(), "sc-pending-"));
    const store = await openStore(dir);
    seedUser(store.db);
    const scope = seedScope(store.db, { name: "/p" });
    expect(countPendingEvents(store.db, scope.id)).toEqual({ events: 0, oldest: null });
    insertEvent(store.db, { scopeId: scope.id, content: "old", createdAt: new Date(1_000) });
    const digest = insertDigest(store.db, { scopeId: scope.id, summary: "d" });
    // insertDigest stamps createdAt = now; events after it are pending
    insertEvent(store.db, { scopeId: scope.id, content: "new-1", createdAt: new Date(Date.now() + 10) });
    insertEvent(store.db, { scopeId: scope.id, content: "new-2", createdAt: new Date(Date.now() + 20) });
    const pending = countPendingEvents(store.db, scope.id);
    expect(pending.events).toBe(2);
    expect(typeof pending.oldest).toBe("number");
    void digest;
    await store.close();
  });
});

describe("hasUsableModel", () => {
  it("is true with an injected model or FEATURE_LLM + key, false otherwise", () => {
    expect(hasUsableModel({}, { chat: async () => "" })).toBe(true);
    expect(hasUsableModel({ FEATURE_LLM: "true", MODEL_API_KEY: "k" })).toBe(true);
    expect(hasUsableModel({ FEATURE_LLM: "true", MODEL_STRUCTURED_OUTPUT_API_KEY: "k" })).toBe(true);
    expect(hasUsableModel({ FEATURE_LLM: "true" })).toBe(false);
    expect(hasUsableModel({ MODEL_API_KEY: "k" })).toBe(false);
    expect(hasUsableModel({})).toBe(false);
  });
});
```
(Import `countPendingEvents`, `hasUsableModel` from `../src/digest` and `seedUser, seedScope, insertEvent, insertDigest` from `./helpers/seed`; `mkdtempSync`/`tmpdir`/`join`/`openStore` as the file already does or add them.) Note: `insertEvent` in `seed.ts` sets `ingestedAt = Date.now()` regardless of `createdAt`, so the "old" event with `createdAt: 1000` is still pending by `ingestedAt` if inserted AFTER the digest — that is why it is inserted BEFORE the digest here.

- [ ] **Step 2: Run red**, then implement in `digest.ts`:

```ts
/** Stream events not yet folded into a digest: newer than the latest digest by either clock (see selectDigestEventWindow for why both), unsuppressed. `oldest` is the earliest pending createdAt in ms, or null. */
export function countPendingEvents(db: LiteDb, scopeId: string): { events: number; oldest: number | null } {
  const lastDigest = db.get<{ createdAt: number }>(`SELECT "createdAt" FROM "Digest" WHERE "scopeId" = ? ORDER BY "createdAt" DESC, "id" DESC LIMIT 1`, scopeId);
  const since = lastDigest?.createdAt ?? 0;
  const row = db.get<{ n: number; oldest: number | null }>(
    `SELECT COUNT(*) AS n, MIN("createdAt") AS oldest FROM "MemoryEvent" WHERE "scopeId" = ? AND "type" = 'stream' AND "suppressedAt" IS NULL AND ("createdAt" > ? OR "ingestedAt" > ?)`,
    scopeId, since, since
  )!;
  return { events: Number(row.n), oldest: row.n ? row.oldest : null };
}

/** Whether a digest could run at all: an injected chat model, or the env-configured provider gate `maybeRunDigest` applies. */
export function hasUsableModel(env: NodeJS.ProcessEnv, digestLlm?: DigestChatModel): boolean {
  if (digestLlm) return true;
  const cfg = readDigestEnv(env);
  return cfg.featureLlm && Boolean(cfg.structuredOutputApiKey ?? cfg.apiKey);
}
```
and replace `maybeRunDigest`'s inline `lastDigest`/`pendingCount` reads with `const pendingCount = countPendingEvents(db, scopeId).events;` and the model gate with `if (!digestLlm && !hasUsableModel(env)) return "skipped-no-llm";` (keep the digestLlm short-circuit semantics identical). Note `readDigestEnv` logs on a malformed threshold; `hasUsableModel` calling it is acceptable.

- [ ] **Step 3: Green** — `pnpm --filter statecore-mcp exec vitest run tests/digest-trigger.test.ts tests/digest-keyed.test.ts tests/digest-now.test.ts` → PASS. **Commit:** `refactor(mcp): countPendingEvents and hasUsableModel shared by the digest trigger`

---

### Task 2: `distillation` on `remember`, `pendingEvents()` on the backend, `facts` tool shape

**Files:**
- Modify: `apps/mcp/src/backend.ts`, `apps/mcp/src/embedded.ts`, `apps/mcp/src/http-backend.ts`, `apps/mcp/src/tools.ts`
- Test: `apps/mcp/tests/embedded.test.ts`, `apps/mcp/tests/tools.test.ts`, `apps/mcp/tests/http-backend.test.ts`

**Interfaces:**
```ts
// backend.ts
remember(input): Promise<{ ok: true; mode: "note" | "event"; superseded?: string; distillation?: "scheduled" | "deferred"; reason?: "no model configured" }>;
pendingEvents?(): Promise<{ events: number; oldest: string } | null>; // ISO oldest; null when zero
```

- [ ] **Step 1: Tests**

`embedded.test.ts` (keyless describe): 
```ts
  it("remember(consolidate) reports deferred distillation keylessly, and pendingEvents counts it", async () => {
    const res = await be.remember({ text: "a long conversational turn about lanterns", consolidate: true });
    expect(res).toMatchObject({ ok: true, mode: "event", distillation: "deferred", reason: "no model configured" });
    const pending = await be.pendingEvents!();
    expect(pending!.events).toBeGreaterThanOrEqual(1);
    expect(new Date(pending!.oldest).toISOString()).toBe(pending!.oldest);
  });
```
and in the `backgroundDigest` describe added in sub-project 2 (stub `digestLlm`, threshold 1): assert `remember({ consolidate: true })` on the DEFAULT backend returns `distillation: "scheduled"`, and on the `backgroundDigest: false` backend returns `distillation: "deferred"` with reason `"no model configured"`? — No: with a model but background disabled the honest value is `"deferred"` and reason stays `"no model configured"` only when no model; use reason `"background digest disabled"`. **Add** `"background digest disabled"` to the `reason` union in `backend.ts`. Assert accordingly. Also assert `pendingEvents()` returns `null` on a fresh scope with no events.

`tools.test.ts`: the `facts` tool returns `{ groups: [...], pending?: {...} }` — extend the existing facts assertion (read the current test to see how it calls the tool) so `JSON.parse(result.content[0].text)` has `groups` as the array previously asserted, and after one `remember({consolidate:true})` the result has `pending.events >= 1`; with no pending events the `pending` key is absent.

`http-backend.test.ts`: `remember({consolidate:true})` resolves `{ ok: true, mode: "event", distillation: "scheduled" }`; `pendingEvents` is `undefined` on the remote backend.

- [ ] **Step 2: Implement**
  - `embedded.ts` `remember` consolidate path: after ingest, `const scheduled = background && hasUsableModel(opts.env, opts.digestLlm);` (where `background = opts.backgroundDigest ?? true`), chain the digest only when `background` (as today), and return `scheduled ? { ok: true, mode: "event", distillation: "scheduled" } : { ok: true, mode: "event", distillation: "deferred", reason: background ? "no model configured" : "background digest disabled" }`.
  - `embedded.ts` `pendingEvents`: `const p = countPendingEvents(store.db, scopeId); return p.events ? { events: p.events, oldest: new Date(p.oldest!).toISOString() } : null;`
  - `http-backend.ts` `remember` consolidate: return `{ ok: true, mode: "event", distillation: "scheduled" }`.
  - `tools.ts` `facts` handler: `const groups = await backend.facts(); const pending = backend.pendingEvents ? await backend.pendingEvents() : null; return json(pending ? { groups, pending } : { groups });` and update the tool description: "List everything currently believed about this project, grouped, with fact ids, plus how many captured events are still waiting for distillation. Use to review or audit the memory."
  - `backend.ts` types as above (with the two reasons).

- [ ] **Step 3: Green** — mcp suite; `tsc --noEmit`. Also update the e2e test if it parses the `facts` tool output (it does in the concurrency test: `result.content.map(c => c.text).join("\n")` — string contains still works; the lifecycle test may parse `JSON.parse(...)` expecting an array — adjust to `.groups`). **Commit:** `feat(mcp): remember reports distillation state; facts reports pending events`

---

### Task 3: `statecore-mcp digest` subcommand

**Files:**
- Create: `apps/mcp/src/cli/digest.ts`
- Modify: `apps/mcp/src/main.ts`
- Test: `apps/mcp/tests/digest-cli.test.ts`

**Interfaces:**
```ts
export async function runDigestCommand(args: { dataDir: string; scopeName: string; env: NodeJS.ProcessEnv; digestLlm?: DigestChatModel }, out: (t: string) => void): Promise<{ exitCode: 0 | 1 }>;
```

- [ ] **Step 1: Tests**

```ts
import { describe, it, expect } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runDigestCommand } from "../src/cli/digest";
import { createEmbeddedBackend } from "../src/embedded";

const STAGE2_OUTPUT = { summary: "Digested on demand.", changes: ["Recorded one event."], nextSteps: ["Continue."], profileFacts: [] };

describe("statecore-mcp digest", () => {
  it("keyless: prints {ran:false, reason:'no-llm'} and exits 0", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "sc-digest-cli-"));
    let out = "";
    const res = await runDigestCommand({ dataDir, scopeName: "/p", env: {} as any }, (t) => (out += t));
    expect(res.exitCode).toBe(0);
    expect(JSON.parse(out)).toEqual({ ran: false, reason: "no-llm" });
  });

  it("with a model and pending events: runs one digest, prints {ran:true}, exits 0; a failing pipeline exits 1", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "sc-digest-cli-run-"));
    const be = createEmbeddedBackend({ dataDir, scopeName: "/p", env: {} as any, backgroundDigest: false });
    await be.init();
    await be.remember({ text: "pending conversational turn", consolidate: true });
    await be.close();

    let out = "";
    let calls = 0;
    const ok = await runDigestCommand(
      { dataDir, scopeName: "/p", env: {} as any, digestLlm: { chat: async () => { calls += 1; return JSON.stringify(STAGE2_OUTPUT); } } },
      (t) => (out += t)
    );
    expect(ok.exitCode).toBe(0);
    expect(JSON.parse(out)).toEqual({ ran: true });
    expect(calls).toBeGreaterThanOrEqual(1);

    const be2 = createEmbeddedBackend({ dataDir, scopeName: "/p", env: {} as any, backgroundDigest: false });
    await be2.init();
    await be2.remember({ text: "another pending turn", consolidate: true });
    await be2.close();
    out = "";
    const bad = await runDigestCommand(
      { dataDir, scopeName: "/p", env: {} as any, digestLlm: { chat: async () => { throw new Error("provider down"); } } },
      (t) => (out += t)
    );
    expect(bad.exitCode).toBe(1);
    expect(JSON.parse(out)).toEqual({ ran: false, reason: "failed" });
  });
});
```

- [ ] **Step 2: Implement `cli/digest.ts`**

```ts
import { createEmbeddedBackend } from "../embedded";
import type { DigestChatModel } from "../digest";

/** `statecore-mcp digest`: one explicit distillation pass for a scope, printed as the DigestNowResult JSON. Exit 1 only when the pipeline itself failed; "nothing pending" and "no model" are ordinary outcomes. */
export async function runDigestCommand(
  args: { dataDir: string; scopeName: string; env: NodeJS.ProcessEnv; digestLlm?: DigestChatModel },
  out: (text: string) => void
): Promise<{ exitCode: 0 | 1 }> {
  const backend = createEmbeddedBackend({ dataDir: args.dataDir, scopeName: args.scopeName, env: args.env, digestLlm: args.digestLlm, backgroundDigest: false });
  await backend.init();
  try {
    const result = await backend.digestNow();
    out(`${JSON.stringify(result)}\n`);
    return { exitCode: !result.ran && result.reason === "failed" ? 1 : 0 };
  } finally {
    await backend.close();
  }
}
```
`main.ts`: add `"digest"` to `SUBCOMMANDS`; branch: `const args = parseArgs(argv.slice(1)); const { exitCode } = await runDigestCommand({ dataDir: args.dataDir ?? defaultDataDir, scopeName: args.scope ?? resolveScopeName(process.cwd(), process.env), env: process.env }, (t) => process.stdout.write(t)); process.exitCode = exitCode;`. Note that a digest run's stderr diagnostics (`[statecore-mcp] digest run failed …`) already go to stderr.

- [ ] **Step 3: Green**, whole suite, tsc. **Commit:** `feat(mcp): digest subcommand runs one explicit distillation pass`

---

### Task 4: `attachFactIds` into core; `factId` on `/v1/memory/facts`; contract 1.7.0

**Files:**
- Modify: `packages/core/src/memory-facts.ts`, `packages/core/src/index.ts` (export if index re-exports memory-facts selectively)
- Modify: `apps/mcp/src/embedded.ts` (import from core, delete local copy)
- Modify: `packages/contracts/src/index.ts`, `apps/api/src/memory-facts.service.ts`, `apps/api/src/openapi.ts`, `apps/api/src/__snapshots__/openapi.test.ts.snap` (regenerate), `docs/api.md`
- Modify: `apps/mcp/src/http-backend.ts` (comment only), `apps/mcp/README.md` (remove the `--url` limitation bullet)
- Tests: core memory-facts test file (find the existing one via `grep -rl "groupFactsForDisplay" packages/core/src/*.test.ts`), `apps/api/src/memory-facts.service.test.ts`, `apps/mcp/tests/http-backend.test.ts`

- [ ] **Step 1: Core** — move `attachFactIds` (body verbatim from `apps/mcp/src/embedded.ts`, including its comment about first-wins dedup) into `packages/core/src/memory-facts.ts`, exported, typed with core's own `DisplayGroup`/`DigestState`/`FacetPack`; ensure `packages/core/src/index.ts` exports it (check how other `memory-facts.ts` exports reach the index — `export * from "./memory-facts"` or explicit names). Add a core unit test: two registry entries in the same display group with identical normalized content resolve to the first id; an entry with no display group gets `factId: null`.

- [ ] **Step 2: Embedded** — `embedded.ts` imports `attachFactIds` from `@statecore/core` and deletes the local function; `pnpm --filter statecore-mcp test` stays green (the collision test in `embedded.test.ts` guards the behaviour).

- [ ] **Step 3: Contract + API** — `MemoryFactsOutput` items: add `factId: z.string().nullable().optional()`. `MemoryFactsService.getFacts` returns `attachFactIds(groupFactsForDisplay(facts, pack), state, pack)`; extend `memory-facts.service.test.ts`: the returned item for "Launching Remi in July" carries `factId: "f1"`. `openapi.ts` version `"1.7.0"`; run `pnpm --filter @statecore/api exec vitest run -u src/openapi.test.ts` (or the file that owns the snapshot — find it with `grep -rl "toMatchSnapshot" apps/api/src`) to regenerate; inspect the snapshot diff: only `factId` and the version should change. `docs/api.md` history line: append `, \`1.7.0\` for the optional \`factId\` on facts items`. Run `pnpm --filter @statecore/api test` (needs the Postgres from `docker-compose.local.yml` for integration tests — if the integration suites cannot run locally because no database is up, run the unit tests you can (`memory-facts.service.test.ts`, `openapi.test.ts`) and report that the integration suites are left to CI).

- [ ] **Step 4: Remote backend** — `http-backend.test.ts`: with a stubbed `/v1/memory/facts` response whose items carry `factId`, `facts()` returns them unchanged (pass-through). Update the comment in `http-backend.ts#facts` to say items carry `factId` since contract 1.7.0 (older servers omit it). Remove the `--url` limitation bullet from `apps/mcp/README.md`.

- [ ] **Step 5: Green** — `pnpm --filter @statecore/core test`, mcp suite, api unit tests, `pnpm lint`. **Commit:** `feat(api,mcp): factId on /v1 facts items (contract 1.7.0); attachFactIds shared from core`

---

### Task 5: docs and changesets

- [ ] `apps/mcp/README.md` keyless table: replace the "Conversational memory" row's No-key cell with "Event is stored and `remember` reports `distillation: "deferred"`; `facts` shows the `pending` count; run `statecore-mcp digest` after configuring a key to distil the backlog" and add a row `\`statecore-mcp digest\` | Reports `{ ran: false, reason: "no-llm" }` | Runs one distillation pass now`.
- [ ] `.changeset/mcp-keyless-visibility.md` (`"statecore-mcp": minor`): distillation state on `remember`, `pending` on the `facts` tool (tool output is now `{ groups, pending? }`), `digest` subcommand, `pendingEvents()` on the embedded backend, `--url` facts carry `factId`.
- [ ] `.changeset/api-facts-factid.md` (`"@statecore/api": minor`, `"@statecore/contracts": minor`, `"@statecore/core": minor`): optional `factId` on `/v1/memory/facts` items, contract 1.7.0; `attachFactIds` exported from core.
- [ ] Verify (mcp suite, lint) and **commit:** `docs: keyless visibility, digest subcommand, factId; changesets`
