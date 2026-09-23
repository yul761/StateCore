import { describe, it, expect } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { openLiteDb } from "../src/lite-db";
import { MIGRATIONS, CURRENT_SCHEMA_VERSION } from "../src/migrations";

/** Builds a database shaped like a real 0.6.0 file: tables from the 0.6.0 DDL,
 * no user_version, and rows stored the way Prisma's SQLite connector stored
 * them — DATETIME as integer unix ms, JSONB as JSON text, BOOLEAN as 0/1. */
function buildLegacyDatabase(path: string): void {
  const raw = new DatabaseSync(path);
  raw.exec(MIGRATIONS[0].sql); // identical to 0.6.0's lite-bootstrap.sql
  const now = 1786833183844;
  raw.prepare(`INSERT INTO "User" ("id", "identity", "createdAt") VALUES (?, ?, ?)`).run("local", "local", now);
  raw.prepare(`INSERT INTO "ProjectScope" ("id", "userId", "name", "stage", "template", "createdAt") VALUES (?, ?, ?, 'idea', 'project', ?)`).run("scope-1", "local", "/legacy/project", now);
  raw
    .prepare(`INSERT INTO "MemoryEvent" ("id", "userId", "scopeId", "type", "source", "content", "createdAt", "ingestedAt", "pinned") VALUES (?, ?, ?, 'stream', 'api', ?, ?, ?, 0)`)
    .run("ev-1", "local", "scope-1", "legacy event text", now, now);
  raw.prepare(`INSERT INTO "Digest" ("id", "scopeId", "summary", "changes", "nextSteps", "createdAt") VALUES (?, ?, 'Notes', '', '[]', ?)`).run("dg-1", "scope-1", now);
  const state = {
    stableFacts: { decisions: [] },
    workingNotes: {},
    todos: [],
    profile: {},
    factRegistry: [
      { id: "reg-1", content: "We use pnpm", type: "profile", confidence: 0.9, addedAt: "2026-08-01T00:00:00.000Z", evidenceId: "ev-1", evidenceType: "event", facet: "note" }
    ]
  };
  raw
    .prepare(`INSERT INTO "DigestStateSnapshot" ("id", "scopeId", "digestId", "state", "consistency", "createdAt") VALUES (?, ?, ?, ?, 'null', ?)`)
    .run("snap-1", "scope-1", "dg-1", JSON.stringify(state), now);
  expect(raw.prepare("PRAGMA user_version").get()).toEqual(expect.objectContaining({ user_version: 0 }));
  raw.close();
}

describe("opening a 0.6.0 database", () => {
  it("stamps user_version to the current schema and keeps every row readable", () => {
    const path = join(mkdtempSync(join(tmpdir(), "sc-legacy-")), "statecore.db");
    buildLegacyDatabase(path);

    const db = openLiteDb(path);
    expect(db.userVersion()).toBe(CURRENT_SCHEMA_VERSION);
    expect(db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM "MemoryEvent"`)!.n).toBe(1);
    const snap = db.get<{ state: string; createdAt: number }>(`SELECT "state", "createdAt" FROM "DigestStateSnapshot" WHERE "id" = 'snap-1'`)!;
    expect(JSON.parse(snap.state).factRegistry[0].content).toBe("We use pnpm");
    expect(typeof snap.createdAt).toBe("number");
    db.close();
  });
});
