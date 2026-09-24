import { randomUUID } from "node:crypto";
import type { ProjectRepo, UserStateRepo, MemoryRepo, DigestRepo, MemoryEvent, UserState } from "@statecore/core";
import type { LiteDb, SqlValue } from "./lite-db";
import {
  EVENT_COLUMNS,
  DIGEST_COLUMNS,
  SCOPE_COLUMNS,
  eventFromRow,
  digestFromRow,
  scopeFromRow,
  placeholders,
  toMs,
  toJson,
  type EventRow,
  type DigestRow,
  type ScopeRow
} from "./rows";

/**
 * `Date.now()`, but never equal to (or behind) the value this same function last
 * returned. Ids here are random UUIDs, not time-ordered, and every table below
 * is listed `ORDER BY "createdAt" DESC, "id" DESC` for pagination — two writes
 * landing in the same millisecond (routine on a fast local disk, and the norm
 * in tests that write back-to-back with no `createdAt` override) would tie on
 * `createdAt` and then sort by a coin flip on `id`, corrupting list order and
 * cursor pagination. This is not part of the Prisma-era mirror above each repo
 * (Postgres's microsecond `DATETIME` resolution made the collision rare enough
 * that it never surfaced); it is required here purely because this store's
 * `createdAt` column is integer milliseconds.
 *
 * Deliberately one counter shared at module scope, not one per repo instance:
 * `apps/mcp/src/embedded.ts` constructs a fresh `makeMemoryRepo(db)` (etc.) at
 * each call site rather than reusing one instance, so a per-instance counter
 * would reset to 0 on every call and the same-millisecond collision it exists
 * to prevent would reappear across independently-constructed repos. A single
 * process-wide counter stays correct regardless of how many repo instances a
 * caller creates, or how it groups tables — it only needs to be strictly
 * increasing within this process, not per table.
 *
 * Caveats: the counter is per-process, so two separate `statecore-mcp`
 * processes writing the same scope in the same millisecond can still tie on
 * `createdAt` — harmless here, since the only consequence is over-counting
 * how many events look "pending" for the digest threshold, never a
 * correctness issue. Separately, `ingestedAt` (the other timestamp column on
 * `MemoryEvent`) is stamped with plain wall-clock `Date.now()`, not this
 * clock, so on a caller that supplies its own drifted `createdAt`, that value
 * can end up a few ms ahead of `ingestedAt`.
 */
function monotonicClock(): () => number {
  let last = 0;
  return () => {
    const now = Date.now();
    last = now > last ? now : last + 1;
    return last;
  };
}
export const nowMs = monotonicClock();

// Mirrors apps/api/src/domain.service.ts#projectsRepo; keep in sync.
export function makeProjectsRepo(db: LiteDb): ProjectRepo {
  const byId = (id: string): ScopeRow => db.get<ScopeRow>(`SELECT ${SCOPE_COLUMNS} FROM "ProjectScope" WHERE "id" = ?`, id)!;
  return {
    create: async (data) => {
      const id = randomUUID();
      db.run(
        `INSERT INTO "ProjectScope" ("id", "userId", "name", "goal", "stage", "template", "createdAt") VALUES (?, ?, ?, ?, ?, ?, ?)`,
        id,
        data.userId,
        data.name,
        data.goal ?? null,
        data.stage ?? "idea",
        data.template ?? "project",
        nowMs()
      );
      return scopeFromRow(byId(id));
    },
    listByUser: async (userId) =>
      db
        .all<ScopeRow>(`SELECT ${SCOPE_COLUMNS} FROM "ProjectScope" WHERE "userId" = ? ORDER BY "createdAt" DESC, "id" DESC`, userId)
        .map(scopeFromRow),
    findById: async (scopeId, userId) => {
      const row = db.get<ScopeRow>(`SELECT ${SCOPE_COLUMNS} FROM "ProjectScope" WHERE "id" = ? AND "userId" = ?`, scopeId, userId);
      return row ? scopeFromRow(row) : null;
    }
  };
}

// Mirrors apps/api/src/domain.service.ts#userStateRepo; keep in sync.
export function makeUserStateRepo(db: LiteDb): UserStateRepo {
  const read = (userId: string): UserState | null => {
    const row = db.get<{ userId: string; activeProjectId: string | null }>(
      `SELECT "userId", "activeProjectId" FROM "UserState" WHERE "userId" = ?`,
      userId
    );
    return row ? { userId: row.userId, activeProjectId: row.activeProjectId } : null;
  };
  return {
    getByUserId: async (userId) => read(userId),
    upsertActiveProject: async (userId, scopeId) => {
      db.run(
        `INSERT INTO "UserState" ("userId", "activeProjectId") VALUES (?, ?)
         ON CONFLICT("userId") DO UPDATE SET "activeProjectId" = excluded."activeProjectId"`,
        userId,
        scopeId
      );
      return read(userId)!;
    }
  };
}

/**
 * `listRecentTurns` is not part of `MemoryRepo` — the working-memory feature
 * that consumes it is out of scope for the embedded backend — but the field
 * ships anyway to keep this closure a verbatim mirror of its source.
 */
export type MirroredMemoryRepo = MemoryRepo & {
  listRecentTurns: (scopeId: string, limit: number) => Promise<MemoryEvent[]>;
};

const EVENT_ORDER = `ORDER BY "createdAt" DESC, "id" DESC`;

// Mirrors apps/api/src/domain.service.ts#memoryRepo; keep in sync.
export function makeMemoryRepo(db: LiteDb): MirroredMemoryRepo {
  const byId = (id: string): EventRow => db.get<EventRow>(`SELECT ${EVENT_COLUMNS} FROM "MemoryEvent" WHERE "id" = ?`, id)!;

  /** Prisma cursor semantics: the cursor row itself is skipped, and the page
   * continues strictly after it in (createdAt DESC, id DESC) order. */
  function pageAfter(scopeId: string, limit: number, cursor: string | null | undefined, extraWhere: string): EventRow[] {
    const params: SqlValue[] = [scopeId];
    let cursorClause = "";
    if (cursor) {
      const anchor = db.get<{ createdAt: number; id: string }>(`SELECT "createdAt", "id" FROM "MemoryEvent" WHERE "id" = ?`, cursor);
      if (!anchor) return [];
      cursorClause = `AND ("createdAt" < ? OR ("createdAt" = ? AND "id" < ?))`;
      params.push(anchor.createdAt, anchor.createdAt, anchor.id);
    }
    params.push(limit + 1);
    return db.all<EventRow>(
      `SELECT ${EVENT_COLUMNS} FROM "MemoryEvent" WHERE "scopeId" = ? ${extraWhere} ${cursorClause} ${EVENT_ORDER} LIMIT ?`,
      ...params
    );
  }

  return {
    create: async (data) => {
      const id = randomUUID();
      // The monotonic tick is only ever the stored value: when the caller backdates
      // `createdAt`, that value wins outright and the tick is never requested.
      // `ingestedAt` is a plain wall-clock stamp — it plays no part in the
      // `ORDER BY "createdAt" ...` tie-break, so it never needs the tick either.
      const createdAt = data.createdAt ? toMs(data.createdAt) : nowMs();
      db.run(
        `INSERT INTO "MemoryEvent" ("id", "userId", "scopeId", "type", "source", "key", "content", "contentHash", "createdAt", "ingestedAt", "pinned")
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        id,
        data.userId,
        data.scopeId,
        data.type,
        data.source,
        data.key ?? null,
        data.content,
        data.contentHash ?? null,
        createdAt,
        Date.now(),
        data.pinned ? 1 : 0
      );
      return eventFromRow(byId(id));
    },
    upsertDocument: async (data) =>
      db.transaction(() => {
        const existing = db.get<{ id: string }>(`SELECT "id" FROM "MemoryEvent" WHERE "scopeId" = ? AND "key" = ?`, data.scopeId, data.key);
        if (existing) {
          // `pinned` must be updatable too: re-uploading a document is the
          // normal way to change its pin state.
          db.run(
            `UPDATE "MemoryEvent" SET "content" = ?, "contentHash" = COALESCE(?, "contentHash"), "updatedAt" = ?, "pinned" = COALESCE(?, "pinned") WHERE "id" = ?`,
            data.content,
            data.contentHash ?? null,
            Date.now(),
            data.pinned === undefined ? null : data.pinned ? 1 : 0,
            existing.id
          );
          return eventFromRow(byId(existing.id));
        }
        const id = randomUUID();
        const createdAt = data.createdAt ? toMs(data.createdAt) : nowMs();
        db.run(
          `INSERT INTO "MemoryEvent" ("id", "userId", "scopeId", "type", "source", "key", "content", "contentHash", "createdAt", "ingestedAt", "pinned")
           VALUES (?, ?, ?, 'document', ?, ?, ?, ?, ?, ?, ?)`,
          id,
          data.userId,
          data.scopeId,
          data.source,
          data.key,
          data.content,
          data.contentHash ?? null,
          createdAt,
          Date.now(),
          data.pinned ? 1 : 0
        );
        return eventFromRow(byId(id));
      }),
    listRecent: async (scopeId, limit, cursor) => {
      const rows = pageAfter(scopeId, limit, cursor, `AND "suppressedAt" IS NULL`);
      // Fetch limit+1 to learn whether more rows exist; the cursor handed back is
      // the LAST RETURNED row, and the next page starts strictly after it. (The
      // Prisma-era mirror returned the popped row as the cursor and then skipped
      // it, silently dropping one row per page; no caller paginated, so nothing
      // observed it. Corrected here on purpose.)
      const hasMore = rows.length > limit;
      if (hasMore) rows.pop();
      return { items: rows.map(eventFromRow), nextCursor: hasMore ? rows[rows.length - 1].id : null };
    },
    findByIds: async (ids) =>
      ids.length
        ? db
            .all<EventRow>(
              `SELECT ${EVENT_COLUMNS} FROM "MemoryEvent" WHERE "id" IN (${placeholders(ids.length)}) AND "suppressedAt" IS NULL ${EVENT_ORDER}`,
              ...ids
            )
            .map(eventFromRow)
        : [],
    replaceTokens: async (eventId, scopeId, tokens) => {
      db.transaction(() => {
        db.run(`DELETE FROM "MemoryEventToken" WHERE "eventId" = ?`, eventId);
        for (const token of tokens) {
          db.run(`INSERT OR IGNORE INTO "MemoryEventToken" ("eventId", "scopeId", "token") VALUES (?, ?, ?)`, eventId, scopeId, token);
        }
      });
    },
    searchByTokens: async (scopeId, tokens, limit) => {
      if (!tokens.length) return [];
      return db
        .all<{ eventId: string }>(
          `SELECT "eventId", COUNT("token") AS c FROM "MemoryEventToken"
           WHERE "scopeId" = ? AND "token" IN (${placeholders(tokens.length)})
           GROUP BY "eventId" ORDER BY c DESC, "eventId" ASC LIMIT ?`,
          scopeId,
          ...tokens,
          limit
        )
        .map((row) => row.eventId);
    },
    tokenStats: async (scopeId, tokens) => {
      if (!tokens.length) return { totalEvents: 0, df: {} };
      const totalEvents = db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM "MemoryEvent" WHERE "scopeId" = ? AND "suppressedAt" IS NULL`, scopeId)!.n;
      const groups = db.all<{ token: string; c: number }>(
        `SELECT "token", COUNT(*) AS c FROM "MemoryEventToken" WHERE "scopeId" = ? AND "token" IN (${placeholders(tokens.length)}) GROUP BY "token"`,
        scopeId,
        ...tokens
      );
      return { totalEvents, df: Object.fromEntries(groups.map((g) => [g.token, g.c])) };
    },
    listByLookback: async (scopeId, since, limit) =>
      db
        .all<EventRow>(
          `SELECT ${EVENT_COLUMNS} FROM "MemoryEvent" WHERE "scopeId" = ? AND "createdAt" >= ? AND "suppressedAt" IS NULL ORDER BY "createdAt" DESC, "id" DESC LIMIT ?`,
          scopeId,
          toMs(since),
          limit
        )
        .map(eventFromRow),
    listRecentTurns: async (scopeId, limit) =>
      db
        .all<EventRow>(`SELECT ${EVENT_COLUMNS} FROM "MemoryEvent" WHERE "scopeId" = ? AND "type" = 'stream' ${EVENT_ORDER} LIMIT ?`, scopeId, limit)
        .map(eventFromRow)
  };
}

// Mirrors apps/api/src/domain.service.ts#digestRepo; keep in sync.
export function makeDigestRepo(db: LiteDb): DigestRepo {
  const byId = (id: string): DigestRow => db.get<DigestRow>(`SELECT ${DIGEST_COLUMNS} FROM "Digest" WHERE "id" = ?`, id)!;
  return {
    create: async (data) => {
      const id = randomUUID();
      db.run(
        `INSERT INTO "Digest" ("id", "scopeId", "summary", "changes", "nextSteps", "rebuildGroupId", "createdAt") VALUES (?, ?, ?, ?, ?, ?, ?)`,
        id,
        data.scopeId,
        data.summary,
        data.changes,
        toJson(data.nextSteps),
        data.rebuildGroupId ?? null,
        nowMs()
      );
      return digestFromRow(byId(id));
    },
    listRecent: async (scopeId, limit, cursor) => {
      const params: SqlValue[] = [scopeId];
      let cursorClause = "";
      if (cursor) {
        const anchor = db.get<{ createdAt: number; id: string }>(`SELECT "createdAt", "id" FROM "Digest" WHERE "id" = ?`, cursor);
        if (!anchor) return { items: [], nextCursor: null };
        cursorClause = `AND ("createdAt" < ? OR ("createdAt" = ? AND "id" < ?))`;
        params.push(anchor.createdAt, anchor.createdAt, anchor.id);
      }
      params.push(limit + 1);
      const rows = db.all<DigestRow>(`SELECT ${DIGEST_COLUMNS} FROM "Digest" WHERE "scopeId" = ? ${cursorClause} ${EVENT_ORDER} LIMIT ?`, ...params);
      const hasMore = rows.length > limit; // same last-returned-row cursor as makeMemoryRepo.listRecent
      if (hasMore) rows.pop();
      return { items: rows.map(digestFromRow), nextCursor: hasMore ? rows[rows.length - 1].id : null };
    },
    findLatest: async (scopeId) => {
      const row = db.get<DigestRow>(`SELECT ${DIGEST_COLUMNS} FROM "Digest" WHERE "scopeId" = ? ${EVENT_ORDER} LIMIT 1`, scopeId);
      return row ? digestFromRow(row) : null;
    }
  };
}
