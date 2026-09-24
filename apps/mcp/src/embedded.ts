import { randomUUID } from "node:crypto";
import {
  MemoryService,
  RetrieveService,
  ProjectService,
  flattenScopeFacts,
  groupFactsForDisplay,
  addNoteFact,
  resolveFacetPackForScope,
  buildFactProvenance,
  getActiveFactRegistry,
  factToGroup,
  computeFactKey,
  activeHandoffFromRows,
  facetAuthority,
  formatHandoff,
  handoffRowsToRegistry,
  HANDOFF_FACET,
  packWithinBudget,
  tokenizeForIndex,
  type DigestState,
  type FacetPack,
  type DisplayGroup
} from "@statecore/core";
import { openStore, type Store } from "./store";
import type { LiteDb } from "./lite-db";
import { makeProjectsRepo, makeUserStateRepo, makeMemoryRepo, makeDigestRepo, nowMs } from "./embedded-repos";
import { parseJson, toJson, fromMs, fromMsNullable, type SnapshotRow } from "./rows";
import type { MemoryBackend } from "./backend";
import { maybeRunDigest, type DigestChatModel } from "./digest";

const USER = "local";

/**
 * `DisplayFact`/`groupFactsForDisplay` (packages/core/src/memory-facts.ts) carry
 * `factKey` but no fact-registry id, so `why()` — which looks entries up by
 * `FactRegistryEntry.id` — has nothing to key on from `facts()` output alone.
 * This recomputes the same `factKey` core derives for each active profile-type
 * registry entry (display group + content, `computeFactKey`) and joins it back
 * onto the grouped display items as `factId`. Local to apps/mcp: core's
 * `memory-facts.ts` has no equivalent join to mirror, since the API's
 * `getFacts` response never needed evidence-chain ids.
 */
function attachFactIds(
  groups: Array<{ group: DisplayGroup; items: Array<{ factKey: string; text: string; createdAt: string | null }> }>,
  state: DigestState,
  pack: FacetPack
): Array<{ group: DisplayGroup; items: Array<{ factKey: string; text: string; createdAt: string | null; factId: string | null }> }> {
  // First-wins: mirror flattenScopeFacts' dedup order (memory-facts.ts:60-69,
  // `if (!byKey.has(factKey))` before insert) so a factKey collision — two
  // sibling facets sharing a displayGroup with identical normalized content —
  // resolves to the same registry entry `facts()` actually displays. Keep in
  // sync with that first-wins invariant.
  const idByFactKey = new Map<string, string>();
  for (const entry of getActiveFactRegistry(state)) {
    if (entry.type !== "profile" || !entry.facet) continue;
    const group = factToGroup(entry.facet, pack);
    if (!group) continue;
    const factKey = computeFactKey(group, entry.content);
    if (!idByFactKey.has(factKey)) idByFactKey.set(factKey, entry.id);
  }
  return groups.map((g) => ({
    group: g.group,
    items: g.items.map((item) => ({ ...item, factId: idByFactKey.get(item.factKey) ?? null }))
  }));
}

/**
 * Startup digest catch-up, across every scope the user has, not just the one
 * this process's `--data`/cwd resolved to (`opts.scopeName`). One SQLite file
 * holds every project's scope, and each scope carries its own backlog and its
 * own `DigestLock` row, so limiting catch-up to the current scope stranded a
 * foreign scope's backlog until something else happened to touch it — the
 * spec asks for catch-up across 各 scope (every scope with backlog).
 * Serialized (each `maybeRunDigest` call completes before the next starts)
 * because this is a fire-and-forget background pass with nothing waiting on
 * its result; running scopes concurrently would only mean acquiring several
 * `DigestLock` rows in parallel for no benefit this process could use.
 * `maybeRunDigest` never rejects (it catches internally), so no scope's
 * failure can stop the ones after it.
 */
async function runStartupDigestCatchUp(db: LiteDb, env: NodeJS.ProcessEnv, digestLlm: DigestChatModel | undefined): Promise<void> {
  const scopes = db.all<{ id: string }>(`SELECT "id" FROM "ProjectScope" WHERE "userId" = ?`, USER);
  for (const scope of scopes) {
    await maybeRunDigest({ db, userId: USER, scopeId: scope.id, env, reason: "startup", digestLlm });
  }
}

const HANDOFF_COLUMNS = '"id", "content", "createdAt", "supersededBy", "retiredAt", "retiredReason"';
interface HandoffDbRow {
  id: string;
  content: string;
  createdAt: number;
  supersededBy: string | null;
  retiredAt: number | null;
  retiredReason: string | null;
}
const handoffRows = (db: LiteDb, scopeId: string) =>
  db.all<HandoffDbRow>(`SELECT ${HANDOFF_COLUMNS} FROM "SessionHandoff" WHERE "scopeId" = ?`, scopeId).map((r) => ({
    ...r,
    createdAt: fromMs(r.createdAt),
    retiredAt: fromMsNullable(r.retiredAt)
  }));

const EMPTY_STATE = (): DigestState => ({ stableFacts: { decisions: [] }, workingNotes: {}, todos: [], factRegistry: [], profile: {} });

/**
 * The keyless, in-process `MemoryBackend`: five memory operations over an
 * embedded SQLite store, with no LLM key required. `remember`/`facts`/`why`/
 * `forget` mirror the Nest-free equivalents in `apps/api/src`, cited at each
 * replicated block.
 *
 * `opts.digestLlm`, when provided, replaces the env-derived model provider
 * `maybeRunDigest` would otherwise construct for both digest call sites below
 * (startup catch-up and the post-`remember` threshold check) — the seam a
 * caller supplying its own LLM client (e.g. the dsh-statecore plugin) uses
 * instead of `FEATURE_LLM`/`MODEL_*` env vars.
 */
export function createEmbeddedBackend(opts: {
  dataDir: string;
  scopeName: string;
  env: NodeJS.ProcessEnv;
  digestLlm?: DigestChatModel;
}): MemoryBackend {
  let store: Store;
  let scopeId: string;
  // Held so digestNow can wait out the startup pass instead of colliding
  // with its threshold-1 runs on the shared in-process digest lock and
  // reporting a spurious "locked" for what is really "already being handled".
  let startupCatchUp: Promise<void> = Promise.resolve();

  const latestSnapshotRow = (): SnapshotRow | undefined =>
    store.db.get<SnapshotRow>(`SELECT "id", "state", "createdAt" FROM "DigestStateSnapshot" WHERE "scopeId" = ? ORDER BY "createdAt" DESC, "id" DESC LIMIT 1`, scopeId);

  async function latestState(): Promise<{ id: string; state: DigestState } | null> {
    const snap = latestSnapshotRow();
    return snap ? { id: snap.id, state: parseJson<DigestState>(snap.state, EMPTY_STATE()) } : null;
  }

  // The scope this backend serves always has template "project" (init() is the
  // only place that creates it, and it always passes "project"), so the pack
  // resolution needs no per-call scope lookup — unlike memory-facts.service.ts,
  // which serves arbitrary scopes and reads `template` off each one.
  const packFor = () =>
    resolveFacetPackForScope(
      {
        findFacetPack: async (id) =>
          parseJson<unknown>(store.db.get<{ facetPack: string | null }>(`SELECT "facetPack" FROM "User" WHERE "id" = ?`, id)?.facetPack ?? null, null) as any
      },
      USER,
      "project"
    );

  return {
    async init() {
      store = await openStore(opts.dataDir);
      store.db.run(`INSERT INTO "User" ("id", "identity", "createdAt") VALUES (?, ?, ?) ON CONFLICT("identity") DO NOTHING`, USER, USER, Date.now());
      const existing = store.db.get<{ id: string }>(`SELECT "id" FROM "ProjectScope" WHERE "userId" = ? AND "name" = ? LIMIT 1`, USER, opts.scopeName);
      scopeId =
        existing?.id ??
        (await new ProjectService(makeProjectsRepo(store.db), makeUserStateRepo(store.db)).createScope(USER, opts.scopeName, null, undefined, "project")).id;
      startupCatchUp = runStartupDigestCatchUp(store.db, opts.env, opts.digestLlm);
      // Backfill the lexical index for events ingested before it existed.
      // Embedded stores are per-project and small, so doing it inline at open
      // is cheap; the server deployment has scripts/backfill-tokens.ts instead.
      const repo = makeMemoryRepo(store.db);
      const unindexed = store.db.all<{ id: string; content: string }>(
        `SELECT e."id", e."content" FROM "MemoryEvent" e WHERE e."scopeId" = ? AND e."suppressedAt" IS NULL
         AND NOT EXISTS (SELECT 1 FROM "MemoryEventToken" t WHERE t."eventId" = e."id")`,
        scopeId
      );
      for (const event of unindexed) await repo.replaceTokens?.(event.id, scopeId, tokenizeForIndex(event.content));
    },

    async remember({ text, consolidate }) {
      if (!consolidate) {
        // Mirrors apps/api/src/memory-facts.service.ts#addNote; keep in sync.
        // The read (latest snapshot), the in-memory addNoteFact mutation, and the
        // write (UPDATE/INSERT) all run inside one store.db.transaction so
        // BEGIN IMMEDIATE holds the write lock across the whole read-modify-write:
        // two MCP processes editing the same scope's snapshot concurrently would
        // otherwise both read the same row, mutate their own in-memory copy, and
        // have the second UPDATE silently drop the first process's note.
        const pack = await packFor();
        const superseded: string | undefined = store.db.transaction(() => {
          const snap = latestSnapshotRow();
          if (snap) {
            const state = parseJson<DigestState>(snap.state, EMPTY_STATE());
            const result = addNoteFact(state, text, () => randomUUID(), () => new Date().toISOString(), pack);
            if (result.changed) store.db.run(`UPDATE "DigestStateSnapshot" SET "state" = ? WHERE "id" = ?`, toJson(state), snap.id);
            return result.superseded;
          }
          const state = EMPTY_STATE();
          addNoteFact(state, text, () => randomUUID(), () => new Date().toISOString(), pack);
          const digestId = randomUUID();
          const now = nowMs();
          store.db.run(`INSERT INTO "Digest" ("id", "scopeId", "summary", "changes", "nextSteps", "createdAt") VALUES (?, ?, 'Notes', '', '[]', ?)`, digestId, scopeId, now);
          store.db.run(
            `INSERT INTO "DigestStateSnapshot" ("id", "scopeId", "digestId", "state", "consistency", "createdAt") VALUES (?, ?, ?, ?, 'null', ?)`,
            randomUUID(), scopeId, digestId, toJson(state), now
          );
          return undefined;
        });
        return superseded !== undefined ? { ok: true, mode: "note", superseded } : { ok: true, mode: "note" };
      }

      await new MemoryService(makeMemoryRepo(store.db)).ingestEvent({ userId: USER, scopeId, type: "stream", source: "api", content: text });
      void maybeRunDigest({ db: store.db, userId: USER, scopeId, env: opts.env, reason: "threshold", digestLlm: opts.digestLlm });
      return { ok: true, mode: "event" };
    },

    async handoff(input) {
      // Mirrors apps/api/src/memory-facts.service.ts#setHandoff; keep in sync.
      // Handoffs live in their own table — see packages/core/src/handoff.ts.
      if (input.clear) {
        const retired = store.db.run(
          `UPDATE "SessionHandoff" SET "retiredAt" = ?, "retiredReason" = 'user_cleared' WHERE "scopeId" = ? AND "supersededBy" IS NULL AND "retiredAt" IS NULL`,
          Date.now(), scopeId
        );
        return { ok: true, superseded: false, cleared: retired.changes > 0 };
      }
      const summary = input.summary?.trim();
      if (!summary) throw new Error("handoff not stored: empty summary");
      const content = formatHandoff({ summary, openQuestions: input.openQuestions, nextSteps: input.nextSteps });
      return store.db.transaction(() => {
        const id = randomUUID();
        store.db.run(`INSERT INTO "SessionHandoff" ("id", "scopeId", "content", "createdAt") VALUES (?, ?, ?, ?)`, id, scopeId, content, nowMs());
        const superseded = store.db.run(
          `UPDATE "SessionHandoff" SET "supersededBy" = ? WHERE "scopeId" = ? AND "supersededBy" IS NULL AND "retiredAt" IS NULL AND "id" != ?`,
          id, scopeId, id
        );
        return { ok: true as const, handoffId: id, superseded: superseded.changes > 0 };
      });
    },

    async recall({ query, maxChars }) {
      const retrieve = new RetrieveService(makeDigestRepo(store.db), makeMemoryRepo(store.db), {});
      const result = await retrieve.retrieve(scopeId, 20, query);
      const digest = result.digest ? result.digest.summary : null;
      const events = result.events.map((event) => ({ id: event.id, content: event.content, createdAt: event.createdAt.toISOString() }));
      // frozen /v1's RetrieveOutput.factRegistry is unconditional (present
      // whether or not the caller sent maxChars) — computed here too so both
      // branches match it, not just the maxChars one.
      const snap = await latestState();
      // Handoff entries stay out of the registry output — the handoff rides in
      // its own field, and a registry copy would compete for the budget it is
      // promised out of. Mirrors apps/api/src/memory.controller.ts#retrieve.
      const activeFactRegistry = (snap ? getActiveFactRegistry(snap.state) : []).filter(
        (entry) => entry.facet !== HANDOFF_FACET
      );
      // The active session handoff rides on every recall, budget or not: it is
      // the "continue from here" briefing, so it must never lose a budget
      // competition to ordinary events.
      const handoff = activeHandoffFromRows(handoffRows(store.db, scopeId));

      if (maxChars === undefined) {
        return { handoff, digest, events, factRegistry: activeFactRegistry, retrieval: (result as { retrieval?: unknown }).retrieval ?? null };
      }

      // Mirrors apps/api/src/memory.controller.ts#retrieve (maxChars branch); keep in sync.
      const trimmedQuery = query?.trim();
      const facetPack = await packFor();
      const packed = packWithinBudget({
        digest,
        facts: activeFactRegistry,
        events,
        maxChars,
        // No query means no relevance signal; the packer falls back to confidence
        // and recency rather than pretending to rank by relevance. The scorer
        // carries the same IDF weights the event ranking used.
        scoreFact: trimmedQuery ? await retrieve.makeScorer(scopeId, trimmedQuery) : undefined,
        // Write protection and document authority carry into the budget
        // competition as a bounded ranking boost.
        factAuthority: (fact) => facetAuthority(facetPack, fact.facet)
      });

      const retrieval = (result as { retrieval?: { matches: Array<{ id: string }>; returnedCount: number } }).retrieval;
      const keptEventIds = new Set(packed.events.map((event) => event.id));
      const narrowedRetrieval = retrieval
        ? (() => {
            const matches = retrieval.matches.filter((match) => keptEventIds.has(match.id));
            return { ...retrieval, matches, returnedCount: matches.length };
          })()
        : (retrieval ?? null);

      return {
        handoff,
        digest: packed.digest,
        events: packed.events,
        factRegistry: packed.facts,
        budget: packed.budget,
        retrieval: narrowedRetrieval
      };
    },

    async facts() {
      // Mirrors apps/api/src/memory-facts.service.ts#getFacts; keep in sync.
      const snapshot = latestSnapshotRow();
      if (!snapshot) return [];
      const forgottenKeys = new Set(store.db.all<{ factKey: string }>(`SELECT "factKey" FROM "ForgottenFact" WHERE "scopeId" = ?`, scopeId).map((f) => f.factKey));
      const pack = await packFor();
      const state = parseJson<DigestState>(snapshot.state, EMPTY_STATE());
      const facts = flattenScopeFacts(state, undefined, pack).filter((f) => !forgottenKeys.has(f.factKey));
      // groupFactsForDisplay drops factRegistry ids; attachFactIds (above) joins
      // them back on so why() has an id to consume.
      return attachFactIds(groupFactsForDisplay(facts, pack), state, pack);
    },

    async why({ factId }) {
      const snap = await latestState();
      const fromRegistry = snap ? buildFactProvenance(snap.state, factId) : null;
      if (fromRegistry) return fromRegistry;
      // Handoffs live in their own table; their chain is walkable through the
      // same tool by mapping rows into entry shape.
      const rows = handoffRows(store.db, scopeId);
      if (!rows.some((r) => r.id === factId)) return null;
      return buildFactProvenance({ ...EMPTY_STATE(), factRegistry: handoffRowsToRegistry(rows) }, factId);
    },

    async digestNow() {
      // Wait out the startup pass first: colliding with its threshold-1 runs
      // would report "locked" for a backlog that pass is already digesting.
      // runStartupDigestCatchUp never rejects, so this await cannot throw.
      await startupCatchUp;
      const outcome = await maybeRunDigest({
        db: store.db,
        userId: USER,
        scopeId,
        env: opts.env,
        reason: "explicit",
        digestLlm: opts.digestLlm
      });
      switch (outcome) {
        case "ran":
          return { ran: true };
        case "skipped-no-llm":
          return { ran: false, reason: "no-llm" };
        case "skipped-below-threshold":
          return { ran: false, reason: "below-threshold" };
        case "skipped-locked":
          return { ran: false, reason: "locked" };
        case "failed":
          return { ran: false, reason: "failed" };
      }
    },

    async forget({ factKey }) {
      // Mirrors apps/api/src/memory-facts.service.ts#forgetFact; keep in sync.
      const snapshot = latestSnapshotRow();
      const pack = await packFor();
      const facts = snapshot ? flattenScopeFacts(parseJson<DigestState>(snapshot.state, EMPTY_STATE()), undefined, pack) : [];
      const match = facts.find((f) => f.factKey === factKey);
      store.db.run(
        `INSERT INTO "ForgottenFact" ("id", "userId", "scopeId", "factKey", "contentSnapshot", "forgottenAt") VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT("scopeId", "factKey") DO NOTHING`,
        randomUUID(), USER, scopeId, factKey, match?.text ?? "", Date.now()
      );
      if (match?.evidenceId) {
        store.db.run(`UPDATE "MemoryEvent" SET "suppressedAt" = ? WHERE "id" = ?`, Date.now(), match.evidenceId);
        // A suppressed event must also leave the lexical index, or it keeps
        // occupying candidate slots that findByIds then filters out.
        store.db.run(`DELETE FROM "MemoryEventToken" WHERE "eventId" = ?`, match.evidenceId);
      }
      return { ok: true };
    },

    close: () => store.close()
  };
}
