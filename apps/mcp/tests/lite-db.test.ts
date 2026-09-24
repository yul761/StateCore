import { describe, it, expect } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { openLiteDb, applyMigrations, type LiteDb } from "../src/lite-db";
import { MIGRATIONS, CURRENT_SCHEMA_VERSION } from "../src/migrations";

function tmpDbPath(prefix: string): string {
  return join(mkdtempSync(join(tmpdir(), prefix)), "statecore.db");
}

describe("openLiteDb", () => {
  it("opens with WAL, busy_timeout and foreign keys on, and applies all migrations", () => {
    const db = openLiteDb(tmpDbPath("sc-litedb-"));
    expect(String(db.get<{ journal_mode: string }>("PRAGMA journal_mode")!.journal_mode).toLowerCase()).toBe("wal");
    expect(db.get<{ timeout: number }>("PRAGMA busy_timeout")!.timeout).toBe(5000);
    expect(db.get<{ foreign_keys: number }>("PRAGMA foreign_keys")!.foreign_keys).toBe(1);
    expect(db.userVersion()).toBe(CURRENT_SCHEMA_VERSION);
    const tables = db.all<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").map((r) => r.name);
    expect(tables).toEqual(expect.arrayContaining(["User", "ProjectScope", "MemoryEvent", "Digest", "DigestStateSnapshot", "SessionHandoff", "ForgottenFact", "MemoryEventToken", "DigestLock"]));
    db.close();
  });

  it("run returns the number of changed rows; get/all bind positional params", () => {
    const db = openLiteDb(tmpDbPath("sc-litedb-"));
    expect(db.run(`INSERT INTO "User" ("id", "identity", "createdAt") VALUES (?, ?, ?)`, "u1", "u1", 1).changes).toBe(1);
    expect(db.get<{ identity: string }>(`SELECT "identity" FROM "User" WHERE "id" = ?`, "u1")!.identity).toBe("u1");
    expect(db.all(`SELECT "id" FROM "User" WHERE "id" IN (?, ?)`, "u1", "nope")).toHaveLength(1);
    db.close();
  });

  it("transaction commits on return and rolls back on throw; nested calls join the outer transaction", () => {
    const db = openLiteDb(tmpDbPath("sc-litedb-"));
    db.transaction(() => {
      db.run(`INSERT INTO "User" ("id", "identity", "createdAt") VALUES ('a', 'a', 1)`);
      db.transaction(() => db.run(`INSERT INTO "User" ("id", "identity", "createdAt") VALUES ('b', 'b', 1)`));
    });
    expect(db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM "User"`)!.n).toBe(2);
    expect(() =>
      db.transaction(() => {
        db.run(`INSERT INTO "User" ("id", "identity", "createdAt") VALUES ('c', 'c', 1)`);
        throw new Error("boom");
      })
    ).toThrow("boom");
    expect(db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM "User"`)!.n).toBe(2);
    db.close();
  });

  it("a second open of the same file is a no-op for migrations and keeps data", () => {
    const path = tmpDbPath("sc-litedb-");
    const first = openLiteDb(path);
    first.run(`INSERT INTO "User" ("id", "identity", "createdAt") VALUES ('a', 'a', 1)`);
    first.close();
    const second = openLiteDb(path);
    expect(second.get<{ n: number }>(`SELECT COUNT(*) AS n FROM "User"`)!.n).toBe(1);
    expect(second.userVersion()).toBe(CURRENT_SCHEMA_VERSION);
    second.close();
  });
});

describe("applyMigrations", () => {
  it("applies only migrations above the current user_version, in order, stamping each", () => {
    const path = tmpDbPath("sc-litedb-");
    const db = openLiteDb(path, []); // no migrations: bare file
    expect(db.userVersion()).toBe(0);
    const fake = [
      { version: 1, sql: `CREATE TABLE IF NOT EXISTS "A" ("x" INTEGER)` },
      { version: 2, sql: `CREATE TABLE IF NOT EXISTS "B" ("x" INTEGER)` }
    ];
    applyMigrations(db, fake);
    expect(db.userVersion()).toBe(2);
    db.run(`INSERT INTO "B" ("x") VALUES (1)`);
    // Re-applying is a no-op: version 2 is already stamped.
    applyMigrations(db, [...fake, { version: 3, sql: `CREATE TABLE "C" ("x" INTEGER)` }]);
    expect(db.userVersion()).toBe(3);
    expect(db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM "B"`)!.n).toBe(1);
    db.close();
  });

  it("a failing migration rolls back and leaves user_version untouched", () => {
    const db = openLiteDb(tmpDbPath("sc-litedb-"), []);
    expect(() => applyMigrations(db, [{ version: 1, sql: `CREATE TABLE "A" ("x" INTEGER); INSERT INTO "Missing" VALUES (1);` }])).toThrow();
    expect(db.userVersion()).toBe(0);
    expect(db.all(`SELECT name FROM sqlite_master WHERE name = 'A'`)).toHaveLength(0);
    db.close();
  });
});
