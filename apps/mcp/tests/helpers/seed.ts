import { randomUUID } from "node:crypto";
import type { LiteDb } from "../../src/lite-db";
import { toJson, parseJson, toMs } from "../../src/rows";

export function seedUser(db: LiteDb, id = "local"): void {
  db.run(`INSERT OR IGNORE INTO "User" ("id", "identity", "createdAt") VALUES (?, ?, ?)`, id, id, Date.now());
}

export function seedScope(db: LiteDb, o: { userId?: string; name: string; template?: string }): { id: string } {
  const id = randomUUID();
  db.run(
    `INSERT INTO "ProjectScope" ("id", "userId", "name", "stage", "template", "createdAt") VALUES (?, ?, ?, 'idea', ?, ?)`,
    id,
    o.userId ?? "local",
    o.name,
    o.template ?? "project",
    Date.now()
  );
  return { id };
}

export function insertEvent(
  db: LiteDb,
  o: { scopeId: string; content: string; userId?: string; type?: "stream" | "document"; createdAt?: Date; key?: string }
): { id: string } {
  const id = randomUUID();
  const now = Date.now();
  db.run(
    `INSERT INTO "MemoryEvent" ("id", "userId", "scopeId", "type", "source", "key", "content", "createdAt", "ingestedAt", "pinned") VALUES (?, ?, ?, ?, 'api', ?, ?, ?, ?, 0)`,
    id,
    o.userId ?? "local",
    o.scopeId,
    o.type ?? "stream",
    o.key ?? null,
    o.content,
    o.createdAt ? toMs(o.createdAt) : now,
    now
  );
  return { id };
}

export function insertDigest(db: LiteDb, o: { scopeId: string; summary: string; changes?: string; nextSteps?: string[] }): { id: string } {
  const id = randomUUID();
  db.run(
    `INSERT INTO "Digest" ("id", "scopeId", "summary", "changes", "nextSteps", "createdAt") VALUES (?, ?, ?, ?, ?, ?)`,
    id,
    o.scopeId,
    o.summary,
    o.changes ?? "",
    toJson(o.nextSteps ?? []),
    Date.now()
  );
  return { id };
}

export function insertSnapshot(db: LiteDb, o: { scopeId: string; digestId: string; state: unknown; consistency?: unknown }): { id: string } {
  const id = randomUUID();
  db.run(
    `INSERT INTO "DigestStateSnapshot" ("id", "scopeId", "digestId", "state", "consistency", "createdAt") VALUES (?, ?, ?, ?, ?, ?)`,
    id,
    o.scopeId,
    o.digestId,
    toJson(o.state),
    toJson(o.consistency ?? null),
    Date.now()
  );
  return { id };
}

export function setUserFacetPack(db: LiteDb, userId: string, pack: unknown): void {
  db.run(`UPDATE "User" SET "facetPack" = ? WHERE "id" = ?`, toJson(pack), userId);
}

export function findScopeByName(db: LiteDb, name: string, userId = "local"): { id: string; name: string } | undefined {
  return db.get<{ id: string; name: string }>(`SELECT "id", "name" FROM "ProjectScope" WHERE "userId" = ? AND "name" = ?`, userId, name);
}

export function latestDigest(
  db: LiteDb,
  scopeId?: string
): { id: string; summary: string; changes: string; nextSteps: string[]; selectionLog: unknown } | undefined {
  const row = scopeId
    ? db.get<{ id: string; summary: string; changes: string; nextSteps: string; selectionLog: string | null }>(
        `SELECT "id", "summary", "changes", "nextSteps", "selectionLog" FROM "Digest" WHERE "scopeId" = ? ORDER BY "createdAt" DESC, "id" DESC LIMIT 1`,
        scopeId
      )
    : db.get<{ id: string; summary: string; changes: string; nextSteps: string; selectionLog: string | null }>(
        `SELECT "id", "summary", "changes", "nextSteps", "selectionLog" FROM "Digest" ORDER BY "createdAt" DESC, "id" DESC LIMIT 1`
      );
  if (!row) return undefined;
  return { ...row, nextSteps: parseJson<string[]>(row.nextSteps, []), selectionLog: parseJson<unknown>(row.selectionLog, null) };
}

export function latestSnapshot(db: LiteDb, scopeId: string): { id: string; state: unknown } | undefined {
  const row = db.get<{ id: string; state: string }>(
    `SELECT "id", "state" FROM "DigestStateSnapshot" WHERE "scopeId" = ? ORDER BY "createdAt" DESC, "id" DESC LIMIT 1`,
    scopeId
  );
  return row ? { id: row.id, state: parseJson<unknown>(row.state, null) } : undefined;
}

export function lockRows(db: LiteDb, scopeId: string): Array<{ scopeId: string }> {
  return db.all<{ scopeId: string }>(`SELECT "scopeId" FROM "DigestLock" WHERE "scopeId" = ?`, scopeId);
}

export function countRows(db: LiteDb, table: string): number {
  return db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM "${table}"`)!.n;
}
