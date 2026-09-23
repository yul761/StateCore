# statecore-mcp storage foundation (sub-project 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Prisma in `apps/mcp`'s embedded mode with Node's built-in `node:sqlite`, add schema versioning with in-place migrations and an `export` command, and drop every install-time lifecycle script — shipping as `statecore-mcp@0.7.0`.

**Architecture:** A thin synchronous wrapper (`lite-db.ts`) over `node:sqlite`'s `DatabaseSync` owns opening, PRAGMAs, transactions and migration application; the DDL lives inline in `migrations.ts` as migration 1. Repository adapters that `@statecore/core` consumes (`ProjectRepo`, `UserStateRepo`, `MemoryRepo`, `DigestRepo`) are rewritten as plain SQL in `embedded-repos.ts`, with row↔entity mapping in `rows.ts`. `embedded.ts`, `digest.ts`, `digest-write.ts`, `digest-lock.ts` and `store.ts` consume `LiteDb` instead of a Prisma client. The public `statecore-mcp/lib` surface keeps its exported names.

**Tech Stack:** TypeScript (CommonJS, ES2022), `node:sqlite` (Node ≥ 22.13), tsup, Vitest, pnpm workspace.

**Spec:** `docs/superpowers/specs/2026-09-23-statecore-mcp-1.0-design.md` (section "Sub-project 1 — storage foundation").

## Global Constraints

- `apps/mcp/package.json` `engines.node` becomes `">=22.13"`. Root `package.json` engines stay `>=20` (api/worker are unaffected).
- No `postinstall`, no `prepublishOnly` copy step, no `prisma`/`@prisma/client` dependency in `apps/mcp`.
- Storage formats must match what Prisma wrote so 0.6.0 databases open unchanged: `DATETIME` columns hold **integer unix milliseconds**, `JSONB` columns hold **JSON text** (`null` is the four-character text `null`), `BOOLEAN` columns hold **0/1**. Every insert sets `createdAt`/`ingestedAt` explicitly as milliseconds; never rely on `DEFAULT CURRENT_TIMESTAMP`.
- `PRAGMA user_version` is the schema version. Migration 1 = the 0.6.0 DDL (idempotent `IF NOT EXISTS`), so a 0.6.0 file at `user_version 0` upgrades by running migration 1 and stamping 1.
- `PRAGMA journal_mode=WAL`, `PRAGMA busy_timeout=5000`, foreign keys ON (node:sqlite default) on every open.
- `statecore-mcp/lib` keeps exporting `createEmbeddedBackend`, `createHttpBackend`, `resolveScopeName`, `runScopeDigest`, `listScopes`, and the types `MemoryBackend`, `DigestNowResult`, `DigestChatModel`, `DigestRunOutcome`. `runScopeDigest`'s first option is renamed `prisma` → `db` (dsh-statecore never calls it; verified 2026-09-23).
- Diagnostics go to stderr only; stdout is the MCP channel (and the `export` payload).
- Commit after every task with a Conventional Commits message. Run `pnpm --filter statecore-mcp test` before each commit from Task 2 onward; some suites will be red mid-way (they are rewritten in Task 5) — the plan names which suites must be green at each commit.
- Work happens on a git worktree branch `mcp-storage-foundation` (create with `superpowers:using-git-worktrees`).

---

## File structure

| Path | Responsibility |
|---|---|
| `apps/mcp/src/lite-db.ts` (new) | Open `DatabaseSync`, PRAGMAs, `run/get/all/exec/transaction/userVersion/close`, `applyMigrations`. |
| `apps/mcp/src/migrations.ts` (new) | `Migration` type and `MIGRATIONS` array; migration 1 is the inline DDL. |
| `apps/mcp/src/rows.ts` (new) | Column lists, `toMs/fromMs/parseJson/toJson/placeholders`, row→entity mappers. |
| `apps/mcp/src/embedded-repos.ts` (new) | `makeProjectsRepo`, `makeUserStateRepo`, `makeMemoryRepo`, `makeDigestRepo` over `LiteDb`. |
| `apps/mcp/src/store.ts` (rewrite) | `Store { db, close }`, `openStore(dataDir)`, `listScopes(dataDir)`. |
| `apps/mcp/src/digest-lock.ts` (modify) | Same two functions over `LiteDb`. |
| `apps/mcp/src/digest-write.ts` (modify) | `createDigestWithSnapshot(db, input)` in one transaction. |
| `apps/mcp/src/digest-lookback.ts` (modify) | Returns a SQL fragment + params instead of a Prisma `where`. |
| `apps/mcp/src/digest.ts` (modify) | All reads via SQL; `maybeRunDigest({ db })`, `runScopeDigest({ db })`. |
| `apps/mcp/src/embedded.ts` (modify) | Backend over `LiteDb` using `embedded-repos.ts`. |
| `apps/mcp/src/cli/export.ts` (new) | `buildExport(db, scopeName?)` and the `export` subcommand. |
| `apps/mcp/src/main.ts` (modify) | Subcommand dispatch (`export`) before the default server path. |
| `apps/mcp/tests/helpers/seed.ts` (new) | Test seeding/reading helpers replacing direct Prisma calls. |
| `apps/mcp/tests/lite-db.test.ts`, `migrations.test.ts`, `embedded-repos.test.ts`, `export.test.ts` (new) | New coverage. |
| `apps/mcp/tests/{store,digest-trigger,digest-keyed,digest-now,lib-export,embedded,ddl-sync,e2e}.test.ts` (modify) | Repointed at the new API. |
| `apps/mcp/package.json`, `tsup.config.ts`, `README.md` (modify); `scripts/postinstall.mjs`, `scripts/prepare-publish.mjs`, `packages/db/lite-bootstrap.sql` (delete) | Package cleanup. |
| `.github/workflows/ci.yml`, `CLAUDE.md`, `STABILITY.md`, `.changeset/*.md` (modify/new) | CI on Node 22 + MCP tests; docs; release note. |

---

### Task 1: `lite-db.ts` and `migrations.ts`

**Files:**
- Create: `apps/mcp/src/lite-db.ts`
- Create: `apps/mcp/src/migrations.ts`
- Test: `apps/mcp/tests/lite-db.test.ts`
- Test: `apps/mcp/tests/migrations.test.ts`

**Interfaces:**
- Produces:
  ```ts
  // lite-db.ts
  export type SqlValue = null | number | string | bigint | Uint8Array;
  export interface LiteDb {
    run(sql: string, ...params: SqlValue[]): { changes: number };
    get<T = Record<string, SqlValue>>(sql: string, ...params: SqlValue[]): T | undefined;
    all<T = Record<string, SqlValue>>(sql: string, ...params: SqlValue[]): T[];
    exec(sql: string): void;
    transaction<T>(fn: () => T): T;
    userVersion(): number;
    close(): void;
  }
  export function openLiteDb(path: string, migrations?: Migration[]): LiteDb;
  export function applyMigrations(db: LiteDb, migrations: Migration[]): void;
  // migrations.ts
  export interface Migration { version: number; sql: string }
  export const MIGRATIONS: Migration[];
  export const CURRENT_SCHEMA_VERSION: number;
  ```

- [ ] **Step 1: Generate `migrations.ts` from the existing DDL**

Run from the repo root (the DDL contains no backticks or `${`, so a template literal is safe):

```bash
node -e '
const fs = require("fs");
const ddl = fs.readFileSync("packages/db/lite-bootstrap.sql", "utf8").trimEnd();
const out = `/**
 * Ordered schema migrations for the embedded SQLite store. \`PRAGMA user_version\`
 * records the highest applied version. Every statement in migration 1 is
 * \`IF NOT EXISTS\`, so a 0.6.0 database (created before versioning existed,
 * user_version 0, tables already present) upgrades by re-running it harmlessly.
 *
 * Rules for adding a migration: append a new object with version = previous + 1,
 * never edit an earlier one, and keep column storage formats Prisma-compatible
 * (DATETIME = integer unix ms, JSONB = JSON text, BOOLEAN = 0/1).
 */
export interface Migration {
  version: number;
  sql: string;
}

const MIGRATION_1_BOOTSTRAP = \`
${ddl}
\`;

export const MIGRATIONS: Migration[] = [{ version: 1, sql: MIGRATION_1_BOOTSTRAP }];

export const CURRENT_SCHEMA_VERSION = MIGRATIONS[MIGRATIONS.length - 1].version;
`;
fs.writeFileSync("apps/mcp/src/migrations.ts", out);
'
grep -c "CREATE TABLE IF NOT EXISTS" apps/mcp/src/migrations.ts
```

Expected: `12`.

- [ ] **Step 2: Write the failing tests**

`apps/mcp/tests/lite-db.test.ts`:

```ts
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
    const applied: number[] = [];
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
    void applied;
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
```

`apps/mcp/tests/migrations.test.ts` — the 0.6.0 upgrade path. It creates a database exactly the way 0.6.0 did (raw DDL via a plain `DatabaseSync`, `user_version` 0, Prisma-style values) and opens it with the new code:

```ts
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
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `pnpm --filter statecore-mcp exec vitest run tests/lite-db.test.ts tests/migrations.test.ts`
Expected: FAIL — `Cannot find module '../src/lite-db'`.

- [ ] **Step 4: Implement `lite-db.ts`**

```ts
import { DatabaseSync } from "node:sqlite";
import { MIGRATIONS, type Migration } from "./migrations";

/** Values node:sqlite accepts as bound parameters. Booleans and Dates are not
 * among them — callers convert with `rows.ts` helpers (0/1 and unix ms). */
export type SqlValue = null | number | string | bigint | Uint8Array;

export interface LiteDb {
  /** Executes one statement with bound params; `changes` is the affected-row count. */
  run(sql: string, ...params: SqlValue[]): { changes: number };
  /** First row of a query, or `undefined`. */
  get<T = Record<string, SqlValue>>(sql: string, ...params: SqlValue[]): T | undefined;
  /** All rows of a query. */
  all<T = Record<string, SqlValue>>(sql: string, ...params: SqlValue[]): T[];
  /** Runs a multi-statement SQL script with no params (DDL, PRAGMAs). */
  exec(sql: string): void;
  /**
   * `BEGIN IMMEDIATE` … `COMMIT`, or `ROLLBACK` if `fn` throws. A call made
   * while a transaction is already open joins it instead of nesting: SQLite
   * has no nested transactions, and every adapter method that needs atomicity
   * is also called from inside larger transactions (digest-write.ts).
   */
  transaction<T>(fn: () => T): T;
  /** `PRAGMA user_version` — the applied schema version. */
  userVersion(): number;
  close(): void;
}

class NodeSqliteDb implements LiteDb {
  private depth = 0;
  constructor(private readonly db: DatabaseSync) {}

  run(sql: string, ...params: SqlValue[]): { changes: number } {
    const result = this.db.prepare(sql).run(...params);
    return { changes: Number(result.changes) };
  }

  get<T>(sql: string, ...params: SqlValue[]): T | undefined {
    return this.db.prepare(sql).get(...params) as T | undefined;
  }

  all<T>(sql: string, ...params: SqlValue[]): T[] {
    return this.db.prepare(sql).all(...params) as T[];
  }

  exec(sql: string): void {
    this.db.exec(sql);
  }

  transaction<T>(fn: () => T): T {
    if (this.depth > 0) {
      this.depth += 1;
      try {
        return fn();
      } finally {
        this.depth -= 1;
      }
    }
    this.db.exec("BEGIN IMMEDIATE");
    this.depth = 1;
    try {
      const result = fn();
      this.db.exec("COMMIT");
      return result;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    } finally {
      this.depth = 0;
    }
  }

  userVersion(): number {
    const row = this.db.prepare("PRAGMA user_version").get() as { user_version: number | bigint };
    return Number(row.user_version);
  }

  close(): void {
    this.db.close();
  }
}

/**
 * Applies every migration whose version is above the file's `user_version`,
 * lowest first, each in its own transaction that also stamps the new version —
 * so a failure leaves the file exactly as it was before that migration.
 */
export function applyMigrations(db: LiteDb, migrations: Migration[]): void {
  const sorted = [...migrations].sort((a, b) => a.version - b.version);
  for (const migration of sorted) {
    if (migration.version <= db.userVersion()) continue;
    db.transaction(() => {
      db.exec(migration.sql);
      db.exec(`PRAGMA user_version = ${migration.version}`);
    });
  }
}

/**
 * Opens (creating if absent) the SQLite file at `path`, sets the connection
 * PRAGMAs every embedded process relies on, and brings the schema up to date.
 * WAL + busy_timeout are what let several processes (one per MCP host) share
 * one file; foreign keys are on by default in node:sqlite and left on.
 */
export function openLiteDb(path: string, migrations: Migration[] = MIGRATIONS): LiteDb {
  const db = new NodeSqliteDb(new DatabaseSync(path));
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA busy_timeout = 5000");
  applyMigrations(db, migrations);
  return db;
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm --filter statecore-mcp exec vitest run tests/lite-db.test.ts tests/migrations.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 6: Type-check and commit**

```bash
pnpm --filter statecore-mcp exec tsc -p tsconfig.json --noEmit
git add apps/mcp/src/lite-db.ts apps/mcp/src/migrations.ts apps/mcp/tests/lite-db.test.ts apps/mcp/tests/migrations.test.ts
git commit -m "feat(mcp): node:sqlite wrapper with versioned migrations"
```

---

### Task 2: `rows.ts` mappers and `store.ts` over `LiteDb`

**Files:**
- Create: `apps/mcp/src/rows.ts`
- Rewrite: `apps/mcp/src/store.ts`
- Create: `apps/mcp/tests/helpers/seed.ts`
- Modify: `apps/mcp/tests/store.test.ts`

**Interfaces:**
- Consumes: `LiteDb`, `openLiteDb` (Task 1).
- Produces:
  ```ts
  // rows.ts
  export function toMs(d: Date): number;
  export function fromMs(v: SqlValue): Date;                 // number | legacy "YYYY-MM-DD HH:MM:SS" text
  export function fromMsNullable(v: SqlValue | undefined): Date | null;
  export function parseJson<T>(v: SqlValue | undefined, fallback: T): T;
  export function toJson(v: unknown): string;               // JSON.stringify; undefined → "null"
  export function toBool(v: SqlValue): boolean;
  export function placeholders(n: number): string;          // "?, ?, ?"
  export const EVENT_COLUMNS: string;                        // quoted, comma-separated
  export interface EventRow { … } export function eventFromRow(row: EventRow): MemoryEvent;
  export interface DigestRow { … } export function digestFromRow(row: DigestRow): Digest;
  export interface ScopeRow { … } export function scopeFromRow(row: ScopeRow): ProjectScope;
  export interface SnapshotRow { id: string; state: string; createdAt: number }
  // store.ts
  export interface Store { db: LiteDb; close(): Promise<void> }
  export function openStore(dataDir: string): Promise<Store>;
  export function listScopes(dataDir: string): Promise<Array<{ id: string; name: string }>>;
  // tests/helpers/seed.ts
  export function seedUser(db: LiteDb, id?: string): void;                       // INSERT OR IGNORE
  export function seedScope(db: LiteDb, o: { userId?: string; name: string; template?: string }): { id: string };
  export function insertEvent(db: LiteDb, o: { scopeId: string; content: string; userId?: string; type?: "stream" | "document"; createdAt?: Date; key?: string }): { id: string };
  export function insertDigest(db: LiteDb, o: { scopeId: string; summary: string; changes?: string; nextSteps?: string[] }): { id: string };
  export function insertSnapshot(db: LiteDb, o: { scopeId: string; digestId: string; state: unknown; consistency?: unknown }): { id: string };
  export function setUserFacetPack(db: LiteDb, userId: string, pack: unknown): void;
  export function findScopeByName(db: LiteDb, name: string, userId?: string): { id: string; name: string } | undefined;
  export function latestDigest(db: LiteDb, scopeId?: string): { id: string; summary: string; changes: string; nextSteps: string[]; selectionLog: unknown } | undefined;
  export function latestSnapshot(db: LiteDb, scopeId: string): { id: string; state: unknown } | undefined;
  export function lockRows(db: LiteDb, scopeId: string): Array<{ scopeId: string }>;
  export function countRows(db: LiteDb, table: string): number;
  ```

- [ ] **Step 1: Write the failing store test**

Replace `apps/mcp/tests/store.test.ts` with:

```ts
import { describe, it, expect } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openStore, listScopes } from "../src/store";
import { seedUser, seedScope, countRows } from "./helpers/seed";

describe("openStore", () => {
  it("creates the database under dataDir, applies DDL idempotently, and enables WAL", async () => {
    const dir = mkdtempSync(join(tmpdir(), "sc-mcp-"));
    const store = await openStore(dir);
    const { journal_mode } = store.db.get<{ journal_mode: string }>("PRAGMA journal_mode")!;
    expect(String(journal_mode).toLowerCase()).toBe("wal");
    // ProjectScope.userId is a real FK to User.id (foreign keys are enforced),
    // so the probe row needs its parent first.
    seedUser(store.db, "local");
    seedScope(store.db, { userId: "local", name: "probe" });
    await store.close();
    const again = await openStore(dir); // second open = idempotent DDL + data kept
    expect(countRows(again.db, "ProjectScope")).toBe(1);
    await again.close();
  });
});

describe("listScopes", () => {
  it("returns every scope in the store sorted by name, opening and closing its own connection", async () => {
    const dir = mkdtempSync(join(tmpdir(), "sc-mcp-scopes-"));
    const store = await openStore(dir);
    seedUser(store.db, "local");
    seedScope(store.db, { userId: "local", name: "/proj/beta" });
    seedScope(store.db, { userId: "local", name: "/proj/alpha" });
    await store.close();
    const scopes = await listScopes(dir);
    expect(scopes.map((s) => s.name)).toEqual(["/proj/alpha", "/proj/beta"]);
    expect(scopes.every((s) => typeof s.id === "string" && s.id.length > 0)).toBe(true);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter statecore-mcp exec vitest run tests/store.test.ts`
Expected: FAIL — `Cannot find module './helpers/seed'`.

- [ ] **Step 3: Write `rows.ts`**

```ts
import type { MemoryEvent, Digest, ProjectScope, MemorySource, MemoryType, ProjectStage } from "@statecore/core";
import type { SqlValue } from "./lite-db";

/** Prisma's SQLite connector stored DateTime as integer unix milliseconds; every
 * write here does the same so 0.6.0 rows and new rows are indistinguishable. */
export function toMs(d: Date): number {
  return d.getTime();
}

/** Reads a DATETIME cell. Integers are unix ms (the only format Prisma wrote);
 * a text value can only come from SQLite's own `CURRENT_TIMESTAMP` default
 * (`YYYY-MM-DD HH:MM:SS`, UTC) on a row inserted by hand, and is accepted too. */
export function fromMs(v: SqlValue): Date {
  if (typeof v === "number" || typeof v === "bigint") return new Date(Number(v));
  if (typeof v === "string") {
    const iso = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(v) ? `${v.replace(" ", "T")}Z` : v;
    return new Date(iso);
  }
  throw new Error(`rows: cannot read a date from ${String(v)}`);
}

export function fromMsNullable(v: SqlValue | undefined): Date | null {
  return v === null || v === undefined ? null : fromMs(v);
}

/** Reads a JSONB cell stored as text. `fallback` covers NULL and the literal
 * text `null` (what Prisma wrote for `Prisma.JsonNull`). */
export function parseJson<T>(v: SqlValue | undefined, fallback: T): T {
  if (typeof v !== "string") return fallback;
  const parsed = JSON.parse(v) as T | null;
  return parsed === null ? fallback : parsed;
}

/** Serializes for a JSONB cell. `undefined` and `null` both become the text
 * `null`, matching what Prisma wrote for `Prisma.JsonNull`. */
export function toJson(v: unknown): string {
  return v === undefined ? "null" : JSON.stringify(v);
}

export function toBool(v: SqlValue): boolean {
  return Number(v) === 1;
}

export function placeholders(n: number): string {
  return Array.from({ length: n }, () => "?").join(", ");
}

export const EVENT_COLUMNS =
  '"id", "userId", "scopeId", "type", "source", "key", "content", "contentHash", "createdAt", "ingestedAt", "updatedAt", "classifiedType", "suppressedAt", "pinned"';

export interface EventRow {
  id: string;
  userId: string;
  scopeId: string;
  type: string;
  source: string;
  key: string | null;
  content: string;
  contentHash: string | null;
  createdAt: number;
  ingestedAt: number;
  updatedAt: number | null;
  classifiedType: string | null;
  suppressedAt: number | null;
  pinned: number;
}

export function eventFromRow(row: EventRow): MemoryEvent {
  return {
    id: row.id,
    userId: row.userId,
    scopeId: row.scopeId,
    type: row.type as MemoryType,
    source: row.source as MemorySource,
    key: row.key,
    content: row.content,
    contentHash: row.contentHash,
    createdAt: fromMs(row.createdAt),
    updatedAt: fromMsNullable(row.updatedAt),
    classifiedType: row.classifiedType,
    pinned: toBool(row.pinned)
  };
}

export const DIGEST_COLUMNS = '"id", "scopeId", "summary", "changes", "nextSteps", "rebuildGroupId", "createdAt"';

export interface DigestRow {
  id: string;
  scopeId: string;
  summary: string;
  changes: string;
  nextSteps: string;
  rebuildGroupId: string | null;
  createdAt: number;
}

export function digestFromRow(row: DigestRow): Digest {
  const nextSteps = parseJson<unknown>(row.nextSteps, []);
  return {
    id: row.id,
    scopeId: row.scopeId,
    summary: row.summary,
    changes: row.changes,
    nextSteps: Array.isArray(nextSteps) ? (nextSteps as string[]) : [],
    rebuildGroupId: row.rebuildGroupId,
    createdAt: fromMs(row.createdAt)
  };
}

export const SCOPE_COLUMNS = '"id", "userId", "name", "goal", "stage", "template", "createdAt"';

export interface ScopeRow {
  id: string;
  userId: string;
  name: string;
  goal: string | null;
  stage: string;
  template: string;
  createdAt: number;
}

export function scopeFromRow(row: ScopeRow): ProjectScope {
  return {
    id: row.id,
    userId: row.userId,
    name: row.name,
    goal: row.goal,
    stage: row.stage as ProjectStage,
    template: row.template,
    createdAt: fromMs(row.createdAt)
  };
}

export interface SnapshotRow {
  id: string;
  state: string;
  createdAt: number;
}
```

If `ProjectStage` is not exported from `@statecore/core`, check `packages/core/src/index.ts` for its name (it is the `stage` union used by `ProjectScope`) and import that.

- [ ] **Step 4: Rewrite `store.ts`**

```ts
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { openLiteDb, type LiteDb } from "./lite-db";

export interface Store {
  db: LiteDb;
  close(): Promise<void>;
}

/**
 * Opens the embedded store at `<dataDir>/statecore.db`, creating the directory
 * and the file on first use and migrating the schema on every open
 * (lite-db.ts#openLiteDb). Async only for API stability: node:sqlite is
 * synchronous, but every caller already awaits this.
 */
export async function openStore(dataDir: string): Promise<Store> {
  mkdirSync(dataDir, { recursive: true });
  const db = openLiteDb(join(dataDir, "statecore.db"));
  return {
    db,
    close: async () => {
      db.close();
    }
  };
}

/**
 * All project scopes in the embedded store at `dataDir`, sorted by name —
 * the store-level view a memory admin surface lists before drilling into one
 * scope's facts. Opens its own short-lived connection (WAL + busy timeout
 * make the concurrent read safe next to live per-scope backends) and always
 * closes it.
 */
export async function listScopes(dataDir: string): Promise<Array<{ id: string; name: string }>> {
  const store = await openStore(dataDir);
  try {
    return store.db.all<{ id: string; name: string }>(`SELECT "id", "name" FROM "ProjectScope" ORDER BY "name" ASC`);
  } finally {
    await store.close();
  }
}
```

- [ ] **Step 5: Write `tests/helpers/seed.ts`**

```ts
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
```

- [ ] **Step 6: Run the store test**

Run: `pnpm --filter statecore-mcp exec vitest run tests/store.test.ts`
Expected: PASS (2 tests). Other suites still import Prisma-era symbols and will fail to type-check until later tasks; that is expected at this commit.

- [ ] **Step 7: Commit**

```bash
git add apps/mcp/src/rows.ts apps/mcp/src/store.ts apps/mcp/tests/helpers/seed.ts apps/mcp/tests/store.test.ts
git commit -m "refactor(mcp): store opens node:sqlite; row mappers and test seed helpers"
```

---

### Task 3: repository adapters in `embedded-repos.ts`

**Files:**
- Create: `apps/mcp/src/embedded-repos.ts`
- Test: `apps/mcp/tests/embedded-repos.test.ts`

**Interfaces:**
- Consumes: `LiteDb`; `rows.ts` mappers; core's `ProjectRepo`, `UserStateRepo`, `MemoryRepo`, `DigestRepo` (`packages/core/src/index.ts:140-197`).
- Produces:
  ```ts
  export type MirroredMemoryRepo = MemoryRepo & { listRecentTurns: (scopeId: string, limit: number) => Promise<MemoryEvent[]> };
  export function makeProjectsRepo(db: LiteDb): ProjectRepo;
  export function makeUserStateRepo(db: LiteDb): UserStateRepo;
  export function makeMemoryRepo(db: LiteDb): MirroredMemoryRepo;
  export function makeDigestRepo(db: LiteDb): DigestRepo;
  ```

- [ ] **Step 1: Write the failing tests**

`apps/mcp/tests/embedded-repos.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openLiteDb, type LiteDb } from "../src/lite-db";
import { makeProjectsRepo, makeUserStateRepo, makeMemoryRepo, makeDigestRepo } from "../src/embedded-repos";
import { seedUser } from "./helpers/seed";

let db: LiteDb;
beforeEach(() => {
  db = openLiteDb(join(mkdtempSync(join(tmpdir(), "sc-repos-")), "statecore.db"));
  seedUser(db, "local");
});

describe("makeProjectsRepo", () => {
  it("create/findById/listByUser round-trip with defaults and Date createdAt", async () => {
    const repo = makeProjectsRepo(db);
    const created = await repo.create({ userId: "local", name: "/p/one" });
    expect(created).toMatchObject({ userId: "local", name: "/p/one", stage: "idea", template: "project", goal: null });
    expect(created.createdAt).toBeInstanceOf(Date);
    expect(await repo.findById(created.id, "local")).toMatchObject({ id: created.id });
    expect(await repo.findById(created.id, "someone-else")).toBeNull();
    await repo.create({ userId: "local", name: "/p/two", template: "custom" });
    const listed = await repo.listByUser("local");
    expect(listed.map((s) => s.name)).toEqual(["/p/two", "/p/one"]); // newest first
  });
});

describe("makeUserStateRepo", () => {
  it("upsertActiveProject inserts then updates; getByUserId reads it back", async () => {
    const repo = makeUserStateRepo(db);
    const scope = await makeProjectsRepo(db).create({ userId: "local", name: "/p" });
    expect(await repo.getByUserId("local")).toBeNull();
    expect(await repo.upsertActiveProject("local", scope.id)).toEqual({ userId: "local", activeProjectId: scope.id });
    expect(await repo.upsertActiveProject("local", null)).toEqual({ userId: "local", activeProjectId: null });
    expect(await repo.getByUserId("local")).toEqual({ userId: "local", activeProjectId: null });
  });
});

describe("makeMemoryRepo", () => {
  it("create stores an event with ms timestamps and 0/1 pinned, and reads it back typed", async () => {
    const scope = await makeProjectsRepo(db).create({ userId: "local", name: "/p" });
    const repo = makeMemoryRepo(db);
    const ev = await repo.create({ userId: "local", scopeId: scope.id, type: "stream", source: "api", content: "hello", pinned: true });
    expect(ev.createdAt).toBeInstanceOf(Date);
    expect(ev.pinned).toBe(true);
    const raw = db.get<{ createdAt: unknown; pinned: unknown }>(`SELECT "createdAt", "pinned" FROM "MemoryEvent" WHERE "id" = ?`, ev.id)!;
    expect(typeof raw.createdAt).toBe("number");
    expect(raw.pinned).toBe(1);
  });

  it("upsertDocument inserts on first key, updates content/pin on the same key", async () => {
    const scope = await makeProjectsRepo(db).create({ userId: "local", name: "/p" });
    const repo = makeMemoryRepo(db);
    const first = await repo.upsertDocument({ userId: "local", scopeId: scope.id, source: "api", key: "readme", content: "v1" });
    const second = await repo.upsertDocument({ userId: "local", scopeId: scope.id, source: "api", key: "readme", content: "v2", pinned: true });
    expect(second.id).toBe(first.id);
    expect(second).toMatchObject({ content: "v2", pinned: true, type: "document" });
    expect(second.updatedAt).toBeInstanceOf(Date);
    expect(db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM "MemoryEvent"`)!.n).toBe(1);
  });

  it("listRecent pages newest-first with an exclusive cursor and skips suppressed rows", async () => {
    const scope = await makeProjectsRepo(db).create({ userId: "local", name: "/p" });
    const repo = makeMemoryRepo(db);
    const ids: string[] = [];
    for (let i = 0; i < 5; i++) {
      const ev = await repo.create({ userId: "local", scopeId: scope.id, type: "stream", source: "api", content: `e${i}`, createdAt: new Date(1_000 + i) });
      ids.push(ev.id);
    }
    db.run(`UPDATE "MemoryEvent" SET "suppressedAt" = ? WHERE "id" = ?`, Date.now(), ids[3]);
    const page1 = await repo.listRecent(scope.id, 2);
    expect(page1.items.map((e) => e.content)).toEqual(["e4", "e2"]);
    expect(page1.nextCursor).toBe(ids[2]);
    const page2 = await repo.listRecent(scope.id, 2, page1.nextCursor);
    expect(page2.items.map((e) => e.content)).toEqual(["e1", "e0"]);
    expect(page2.nextCursor).toBeNull();
  });

  it("token index: replaceTokens, searchByTokens ranks by match count, tokenStats reports df and totals", async () => {
    const scope = await makeProjectsRepo(db).create({ userId: "local", name: "/p" });
    const repo = makeMemoryRepo(db);
    const a = await repo.create({ userId: "local", scopeId: scope.id, type: "stream", source: "api", content: "a" });
    const b = await repo.create({ userId: "local", scopeId: scope.id, type: "stream", source: "api", content: "b" });
    await repo.replaceTokens!(a.id, scope.id, ["pnpm", "build", "turbo"]);
    await repo.replaceTokens!(b.id, scope.id, ["pnpm"]);
    expect(await repo.searchByTokens!(scope.id, ["pnpm", "build"], 10)).toEqual([a.id, b.id]);
    expect(await repo.tokenStats!(scope.id, ["pnpm", "build", "missing"])).toEqual({ totalEvents: 2, df: { pnpm: 2, build: 1 } });
    await repo.replaceTokens!(a.id, scope.id, []);
    expect(await repo.searchByTokens!(scope.id, ["build"], 10)).toEqual([]);
    expect(await repo.searchByTokens!(scope.id, [], 10)).toEqual([]);
  });

  it("findByIds and listByLookback filter suppressed rows and honour the since bound", async () => {
    const scope = await makeProjectsRepo(db).create({ userId: "local", name: "/p" });
    const repo = makeMemoryRepo(db);
    const old = await repo.create({ userId: "local", scopeId: scope.id, type: "stream", source: "api", content: "old", createdAt: new Date(1_000) });
    const fresh = await repo.create({ userId: "local", scopeId: scope.id, type: "stream", source: "api", content: "fresh", createdAt: new Date(5_000) });
    expect((await repo.findByIds([old.id, fresh.id])).map((e) => e.content)).toEqual(["fresh", "old"]);
    expect(await repo.findByIds([])).toEqual([]);
    expect((await repo.listByLookback(scope.id, new Date(2_000), 10)).map((e) => e.content)).toEqual(["fresh"]);
  });
});

describe("makeDigestRepo", () => {
  it("create stores nextSteps as JSON text and findLatest/listRecent read newest first", async () => {
    const scope = await makeProjectsRepo(db).create({ userId: "local", name: "/p" });
    const repo = makeDigestRepo(db);
    const d1 = await repo.create({ scopeId: scope.id, summary: "one", changes: "- a", nextSteps: ["x"] });
    const d2 = await repo.create({ scopeId: scope.id, summary: "two", changes: "", nextSteps: [], rebuildGroupId: "g1" });
    expect(db.get<{ nextSteps: string }>(`SELECT "nextSteps" FROM "Digest" WHERE "id" = ?`, d1.id)!.nextSteps).toBe('["x"]');
    expect((await repo.findLatest(scope.id))!.id).toBe(d2.id);
    const page = await repo.listRecent(scope.id, 1);
    expect(page.items[0]).toMatchObject({ id: d2.id, rebuildGroupId: "g1", nextSteps: [] });
    expect(page.nextCursor).toBe(d2.id);
    const rest = await repo.listRecent(scope.id, 1, page.nextCursor);
    expect(rest.items[0].id).toBe(d1.id);
    expect(rest.nextCursor).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter statecore-mcp exec vitest run tests/embedded-repos.test.ts`
Expected: FAIL — `Cannot find module '../src/embedded-repos'`.

- [ ] **Step 3: Implement `embedded-repos.ts`**

```ts
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
        Date.now()
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
      const now = Date.now();
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
        data.createdAt ? toMs(data.createdAt) : now,
        now,
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
            `UPDATE "MemoryEvent" SET "content" = ?, "contentHash" = ?, "updatedAt" = ?, "pinned" = COALESCE(?, "pinned") WHERE "id" = ?`,
            data.content,
            data.contentHash ?? null,
            Date.now(),
            data.pinned === undefined ? null : data.pinned ? 1 : 0,
            existing.id
          );
          return eventFromRow(byId(existing.id));
        }
        const id = randomUUID();
        const now = Date.now();
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
          data.createdAt ? toMs(data.createdAt) : now,
          now,
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
          `SELECT ${EVENT_COLUMNS} FROM "MemoryEvent" WHERE "scopeId" = ? AND "createdAt" >= ? AND "suppressedAt" IS NULL ORDER BY "createdAt" DESC LIMIT ?`,
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
        Date.now()
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
```

- [ ] **Step 4: Run the tests**

Run: `pnpm --filter statecore-mcp exec vitest run tests/embedded-repos.test.ts`
Expected: PASS (8 tests). If `listRecent`'s cursor test fails on ordering, check that `createdAt` in the test uses distinct values (it does: 1000..1004) and that `pageAfter`'s `extraWhere` is placed before the cursor clause.

- [ ] **Step 5: Commit**

```bash
git add apps/mcp/src/embedded-repos.ts apps/mcp/tests/embedded-repos.test.ts
git commit -m "feat(mcp): SQL repository adapters over node:sqlite"
```

---

### Task 4: digest path over `LiteDb` (`digest-lock`, `digest-write`, `digest-lookback`, `digest.ts`)

**Files:**
- Modify: `apps/mcp/src/digest-lock.ts`
- Modify: `apps/mcp/src/digest-write.ts`
- Modify: `apps/mcp/src/digest-lookback.ts`
- Modify: `apps/mcp/src/digest.ts`
- Modify: `apps/mcp/tests/digest-trigger.test.ts`, `apps/mcp/tests/digest-keyed.test.ts`

**Interfaces:**
- Consumes: `LiteDb`, `rows.ts`, `seed.ts` helpers.
- Produces:
  ```ts
  export async function acquireDigestLock(db: LiteDb, scopeId: string): Promise<boolean>;
  export async function releaseDigestLock(db: LiteDb, scopeId: string): Promise<void>;
  export async function createDigestWithSnapshot(db: LiteDb, input: CreateDigestWithSnapshotInput): Promise<{ id: string }>;
  export function selectDigestEventWindow(input: DigestWindowInput): { where: string; params: SqlValue[] };
  export async function maybeRunDigest(opts: { db: LiteDb; userId; scopeId; env; reason; digestLlm? }): Promise<DigestRunOutcome>;
  export async function runScopeDigest(opts: { db: unknown; userId; scopeId; llm; env? }): Promise<void>;
  ```

- [ ] **Step 1: Rewrite `digest-lock.ts`**

```ts
import type { LiteDb } from "./lite-db";

/**
 * How long a `DigestLock` row is honored before it is treated as abandoned
 * and reclaimed. Guards against a process that acquired the lock and crashed
 * (or was killed) before releasing it, which would otherwise strand the scope
 * with no digest catch-up forever.
 */
const LOCK_EXPIRY_MINUTES = 30;

/**
 * Serializes digest runs for one scope across every process sharing the same
 * SQLite file. Reclaims any lock older than `LOCK_EXPIRY_MINUTES`, then relies
 * on `INSERT OR IGNORE` for atomicity: the insert either creates the row
 * (lock acquired) or no-ops on the primary-key conflict. `acquiredAt` is
 * SQLite's own `datetime('now')` text, compared with the same function, so it
 * is independent of the integer-ms convention the entity tables use.
 */
export async function acquireDigestLock(db: LiteDb, scopeId: string): Promise<boolean> {
  db.run(`DELETE FROM "DigestLock" WHERE "acquiredAt" < datetime('now', '-${LOCK_EXPIRY_MINUTES} minutes')`);
  return db.run(`INSERT OR IGNORE INTO "DigestLock" ("scopeId", "acquiredAt") VALUES (?, datetime('now'))`, scopeId).changes > 0;
}

/** Releases a lock; a release on a scope with no held lock is a no-op. */
export async function releaseDigestLock(db: LiteDb, scopeId: string): Promise<void> {
  db.run(`DELETE FROM "DigestLock" WHERE "scopeId" = ?`, scopeId);
}
```

- [ ] **Step 2: Rewrite `digest-write.ts`**

```ts
// Mirrors apps/worker/src/digest-write.ts; keep in sync.
// Atomic digest + state-snapshot writer: one transaction, so a failed snapshot
// write rolls back the digest — no snapshotless latest-digest for data_gc to
// mishandle.
import { randomUUID } from "node:crypto";
import { carryOverConcurrentNotes, type DigestState } from "@statecore/core";
import type { LiteDb } from "./lite-db";
import { parseJson, toJson } from "./rows";

export interface CreateDigestWithSnapshotInput {
  scopeId: string;
  summary: string;
  changes: string; // already-joined "- ..." string
  nextSteps: unknown;
  state: unknown;
  consistency: unknown;
  /** `{ rationale, drops }` — what the selection stage kept and what it discarded. */
  selectionLog?: unknown;
  rebuildGroupId?: string;
}

export async function createDigestWithSnapshot(db: LiteDb, input: CreateDigestWithSnapshotInput): Promise<{ id: string }> {
  return db.transaction(() => {
    // Close the lost-update window for concurrently written notes: the
    // pipeline's state was projected from a snapshot read seconds-to-minutes
    // ago, and this create makes that stale view the latest. A note written to
    // the previous snapshot row in the meantime would silently leave the
    // lineage; re-read the row here and carry such entries over.
    const latest = db.get<{ state: string }>(
      `SELECT "state" FROM "DigestStateSnapshot" WHERE "scopeId" = ? ORDER BY "createdAt" DESC, "id" DESC LIMIT 1`,
      input.scopeId
    );
    const latestState = latest ? parseJson<DigestState | null>(latest.state, null) : null;
    if (latestState) carryOverConcurrentNotes(input.state as DigestState, latestState);

    const now = Date.now();
    const digestId = randomUUID();
    db.run(
      `INSERT INTO "Digest" ("id", "scopeId", "summary", "changes", "nextSteps", "selectionLog", "rebuildGroupId", "createdAt") VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      digestId,
      input.scopeId,
      input.summary,
      input.changes,
      toJson(input.nextSteps),
      input.selectionLog === undefined ? null : toJson(input.selectionLog),
      input.rebuildGroupId ?? null,
      now
    );
    db.run(
      `INSERT INTO "DigestStateSnapshot" ("id", "scopeId", "digestId", "state", "consistency", "createdAt") VALUES (?, ?, ?, ?, ?, ?)`,
      randomUUID(),
      input.scopeId,
      digestId,
      toJson(input.state),
      toJson(input.consistency),
      now
    );
    return { id: digestId };
  });
}
```

- [ ] **Step 3: Rewrite `digest-lookback.ts`'s return shape**

Keep the file's doc comment; replace the function:

```ts
import type { SqlValue } from "./lite-db";

export interface DigestWindowInput {
  scopeId: string;
  lookbackDays: number;
  now?: Date;
}

/** A SQL fragment (no leading AND) and its params selecting the events one
 * digest run considers: this scope, unsuppressed, and recent by either clock
 * when a positive lookback is configured. */
export function selectDigestEventWindow(input: DigestWindowInput): { where: string; params: SqlValue[] } {
  const base = { where: `"scopeId" = ? AND "suppressedAt" IS NULL`, params: [input.scopeId] as SqlValue[] };

  // A lookback of zero or less is a misconfiguration, not an instruction to
  // digest nothing. Leaving the window off is the safe reading — the event-count
  // and character budgets still bound the work.
  if (!Number.isFinite(input.lookbackDays) || input.lookbackDays <= 0) return base;

  const cutoff = (input.now ?? new Date()).getTime() - input.lookbackDays * 86_400_000;
  return {
    where: `${base.where} AND ("createdAt" >= ? OR "ingestedAt" >= ?)`,
    params: [...base.params, cutoff, cutoff]
  };
}
```

- [ ] **Step 4: Port `digest.ts`**

Apply these edits (everything not listed stays as is):

1. Imports: replace `import type { LitePrisma } from "./store";` with
   ```ts
   import type { LiteDb } from "./lite-db";
   import { EVENT_COLUMNS, SCOPE_COLUMNS, eventFromRow, scopeFromRow, parseJson, digestFromRow, DIGEST_COLUMNS, type EventRow, type ScopeRow, type DigestRow } from "./rows";
   ```
   Delete the local `DigestRow` type and `toCoreDigest` (use `digestFromRow`).
2. `makeFacetPackStore(db: LiteDb)`:
   ```ts
   function makeFacetPackStore(db: LiteDb): FacetPackStore {
     return {
       findFacetPack: async (userId) =>
         parseJson<unknown>(db.get<{ facetPack: string | null }>(`SELECT "facetPack" FROM "User" WHERE "id" = ?`, userId)?.facetPack ?? null, null) as any
     };
   }
   ```
3. `runDigestPipelineCore(db: LiteDb, userId, scopeId, llm)` body reads:
   ```ts
   const scopeRow = db.get<ScopeRow>(`SELECT ${SCOPE_COLUMNS} FROM "ProjectScope" WHERE "id" = ? AND "userId" = ?`, scopeId, userId);
   if (!scopeRow) { console.error(`[statecore-mcp] digest: scope ${scopeId} not found for user ${userId}; skipping`); return; }
   const scope = scopeFromRow(scopeRow);
   const facetPack = await resolveFacetPackForScope(makeFacetPackStore(db), userId, scope.template ?? "project");

   const lastDigestRow = db.get<DigestRow>(`SELECT ${DIGEST_COLUMNS} FROM "Digest" WHERE "scopeId" = ? ORDER BY "createdAt" DESC, "id" DESC LIMIT 1`, scopeId);
   const lastStateRow = db.get<{ state: string }>(`SELECT "state" FROM "DigestStateSnapshot" WHERE "scopeId" = ? ORDER BY "createdAt" DESC, "id" DESC LIMIT 1`, scopeId);

   const window = selectDigestEventWindow({ scopeId, lookbackDays: DIGEST_CONFIG.maxDaysLookback });
   const recentStreamEvents = db
     .all<EventRow>(
       `SELECT ${EVENT_COLUMNS} FROM "MemoryEvent" WHERE ${window.where} AND "type" = 'stream' ORDER BY "createdAt" DESC, "id" DESC LIMIT ?`,
       ...window.params,
       lastDigestRow ? DIGEST_CONFIG.maxRecentEvents : DIGEST_CONFIG.firstRunMaxEvents
     )
     .map(eventFromRow);
   const recentDocumentEvents = db
     .all<EventRow>(`SELECT ${EVENT_COLUMNS} FROM "MemoryEvent" WHERE ${window.where} AND "type" = 'document' ORDER BY "createdAt" DESC, "id" DESC`, ...window.params)
     .map(eventFromRow);
   const recentEvents = [...recentStreamEvents, ...recentDocumentEvents];

   const prevDigestState = lastStateRow ? parseJson<DigestState | null>(lastStateRow.state, null) : null;

   const forgottenRows = db.all<{ factKey: string; contentSnapshot: string | null }>(
     `SELECT "factKey", "contentSnapshot" FROM "ForgottenFact" WHERE "scopeId" = ? ORDER BY "forgottenAt" DESC LIMIT 100`,
     scopeId
   );
   ```
   then the unchanged `runDigestControlPipeline({ scope, lastDigest: lastDigestRow ? digestFromRow(lastDigestRow) : null, prevState: prevDigestState, recentEvents, llm, prompts, pack: facetPack, config, forgottenFactKeys, forgottenFactContents })` and `await createDigestWithSnapshot(db, {...})`.
4. `runDigestPipeline(db: LiteDb, ...)` — rename the parameter and pass `db` through.
5. `runScopeDigest(opts: { db: unknown; userId; scopeId; llm; env? })` — `const db = opts.db as LiteDb;` and update the JSDoc `@param opts.db`.
6. `maybeRunDigest(opts: { db: LiteDb; ... })`:
   ```ts
   const lastDigest = db.get<{ createdAt: number }>(`SELECT "createdAt" FROM "Digest" WHERE "scopeId" = ? ORDER BY "createdAt" DESC, "id" DESC LIMIT 1`, scopeId);
   const sinceLastDigest = lastDigest?.createdAt ?? 0;
   const pendingCount = db.get<{ n: number }>(
     `SELECT COUNT(*) AS n FROM "MemoryEvent" WHERE "scopeId" = ? AND "type" = 'stream' AND "suppressedAt" IS NULL AND ("createdAt" > ? OR "ingestedAt" > ?)`,
     scopeId, sinceLastDigest, sinceLastDigest
   )!.n;
   ```
   Everything else (gates, lock, `running`, try/catch → `"failed"`) unchanged, with `prisma` → `db`.

- [ ] **Step 5: Repoint `digest-trigger.test.ts` and `digest-keyed.test.ts`**

`digest-trigger.test.ts`: `acquireDigestLock(store.prisma, …)` → `acquireDigestLock(store.db, …)`. The "never rejects" test's stub becomes a db whose first read throws:

```ts
const failingDb = {
  get: () => {
    throw new Error("database is locked");
  }
} as any;
await expect(maybeRunDigest({ db: failingDb, userId: "local", scopeId: "scope-boom", env: { FEATURE_LLM: "true", MODEL_API_KEY: "test-key" } as any, reason: "threshold" })).resolves.toBe("failed");
```

`digest-keyed.test.ts`: replace direct Prisma calls with helpers (import from `./helpers/seed`):

| Was | Becomes |
|---|---|
| `store.prisma.user.upsert({ where: { identity: USER }, … })` | `seedUser(store.db, USER)` |
| `store.prisma.projectScope.create({ data: { userId, name, template } })` | `seedScope(store.db, { userId, name, template })` |
| `store.prisma.memoryEvent.create({ data: { userId, scopeId, type: "stream", source: "api", content } })` | `insertEvent(store.db, { scopeId, content })` |
| `maybeRunDigest({ prisma: store.prisma, … })` | `maybeRunDigest({ db: store.db, … })` |
| `store.prisma.digest.findFirst({ where: { scopeId } })` | `latestDigest(store.db, scopeId)` |
| `store.prisma.digestStateSnapshot.findFirst({ where: { scopeId } })` | `latestSnapshot(store.db, scopeId)` |
| `store.prisma.$queryRawUnsafe('SELECT "scopeId" FROM "DigestLock" …')` | `lockRows(store.db, scopeId)` |

Where the test read `digestRow.summary`/`snapshot.state`, the helper results carry the same field names with JSON already parsed.

- [ ] **Step 6: Run the digest suites**

Run: `pnpm --filter statecore-mcp exec vitest run tests/digest-trigger.test.ts tests/digest-keyed.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/mcp/src/digest-lock.ts apps/mcp/src/digest-write.ts apps/mcp/src/digest-lookback.ts apps/mcp/src/digest.ts apps/mcp/tests/digest-trigger.test.ts apps/mcp/tests/digest-keyed.test.ts
git commit -m "refactor(mcp): digest path reads and writes through node:sqlite"
```

---

### Task 5: `embedded.ts` over `LiteDb`; remaining suites green

**Files:**
- Modify: `apps/mcp/src/embedded.ts`
- Modify: `apps/mcp/tests/embedded.test.ts`, `apps/mcp/tests/digest-now.test.ts`, `apps/mcp/tests/lib-export.test.ts`

**Interfaces:**
- Consumes: `openStore`/`Store` (Task 2), repos (Task 3), `maybeRunDigest({ db })` (Task 4).
- Produces: unchanged `createEmbeddedBackend(opts): MemoryBackend`.

- [ ] **Step 1: Port `embedded.ts`**

Replace the import block's store/digest lines and delete the four `make*Repo` functions and `MirroredMemoryRepo` (now in `embedded-repos.ts`):

```ts
import { openStore, type Store } from "./store";
import type { LiteDb } from "./lite-db";
import { makeProjectsRepo, makeUserStateRepo, makeMemoryRepo, makeDigestRepo } from "./embedded-repos";
import { parseJson, toJson, fromMs, fromMsNullable, type SnapshotRow } from "./rows";
import type { MemoryBackend } from "./backend";
import { maybeRunDigest, type DigestChatModel } from "./digest";
```

Keep `attachFactIds` verbatim. Replace the rest:

```ts
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

export function createEmbeddedBackend(opts: { dataDir: string; scopeName: string; env: NodeJS.ProcessEnv; digestLlm?: DigestChatModel }): MemoryBackend {
  let store: Store;
  let scopeId: string;
  let startupCatchUp: Promise<void> = Promise.resolve();

  const latestSnapshotRow = (): SnapshotRow | undefined =>
    store.db.get<SnapshotRow>(`SELECT "id", "state", "createdAt" FROM "DigestStateSnapshot" WHERE "scopeId" = ? ORDER BY "createdAt" DESC, "id" DESC LIMIT 1`, scopeId);

  async function latestState(): Promise<{ id: string; state: DigestState } | null> {
    const snap = latestSnapshotRow();
    return snap ? { id: snap.id, state: parseJson<DigestState>(snap.state, EMPTY_STATE()) } : null;
  }

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
        const snap = await latestState();
        const pack = await packFor();
        let superseded: string | undefined;
        if (snap) {
          const result = addNoteFact(snap.state, text, () => randomUUID(), () => new Date().toISOString(), pack);
          superseded = result.superseded;
          if (result.changed) store.db.run(`UPDATE "DigestStateSnapshot" SET "state" = ? WHERE "id" = ?`, toJson(snap.state), snap.id);
        } else {
          const state = EMPTY_STATE();
          addNoteFact(state, text, () => randomUUID(), () => new Date().toISOString(), pack);
          store.db.transaction(() => {
            const digestId = randomUUID();
            const now = Date.now();
            store.db.run(`INSERT INTO "Digest" ("id", "scopeId", "summary", "changes", "nextSteps", "createdAt") VALUES (?, ?, 'Notes', '', '[]', ?)`, digestId, scopeId, now);
            store.db.run(
              `INSERT INTO "DigestStateSnapshot" ("id", "scopeId", "digestId", "state", "consistency", "createdAt") VALUES (?, ?, ?, ?, 'null', ?)`,
              randomUUID(), scopeId, digestId, toJson(state), now
            );
          });
        }
        return superseded !== undefined ? { ok: true, mode: "note", superseded } : { ok: true, mode: "note" };
      }

      await new MemoryService(makeMemoryRepo(store.db)).ingestEvent({ userId: USER, scopeId, type: "stream", source: "api", content: text });
      void maybeRunDigest({ db: store.db, userId: USER, scopeId, env: opts.env, reason: "threshold", digestLlm: opts.digestLlm });
      return { ok: true, mode: "event" };
    },

    async handoff(input) {
      // Mirrors apps/api/src/memory-facts.service.ts#setHandoff; keep in sync.
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
        store.db.run(`INSERT INTO "SessionHandoff" ("id", "scopeId", "content", "createdAt") VALUES (?, ?, ?, ?)`, id, scopeId, content, Date.now());
        const superseded = store.db.run(
          `UPDATE "SessionHandoff" SET "supersededBy" = ? WHERE "scopeId" = ? AND "supersededBy" IS NULL AND "retiredAt" IS NULL AND "id" != ?`,
          id, scopeId, id
        );
        return { ok: true as const, handoffId: id, superseded: superseded.changes > 0 };
      });
    },

    async recall({ query, maxChars }) {
      const retrieve = new RetrieveService(makeDigestRepo(store.db), makeMemoryRepo(store.db), {});
      // … identical to the current body, with these two substitutions:
      //   activeHandoffFromRows(await store.prisma.sessionHandoff.findMany({ where: { scopeId } }))
      //     → activeHandoffFromRows(handoffRows(store.db, scopeId))
      //   (no other store access in this method)
    },

    async facts() {
      // Mirrors apps/api/src/memory-facts.service.ts#getFacts; keep in sync.
      const snapshot = latestSnapshotRow();
      if (!snapshot) return [];
      const forgottenKeys = new Set(store.db.all<{ factKey: string }>(`SELECT "factKey" FROM "ForgottenFact" WHERE "scopeId" = ?`, scopeId).map((f) => f.factKey));
      const pack = await packFor();
      const state = parseJson<DigestState>(snapshot.state, EMPTY_STATE());
      const facts = flattenScopeFacts(state, undefined, pack).filter((f) => !forgottenKeys.has(f.factKey));
      return attachFactIds(groupFactsForDisplay(facts, pack), state, pack);
    },

    async why({ factId }) {
      const snap = await latestState();
      const fromRegistry = snap ? buildFactProvenance(snap.state, factId) : null;
      if (fromRegistry) return fromRegistry;
      const rows = handoffRows(store.db, scopeId);
      if (!rows.some((r) => r.id === factId)) return null;
      return buildFactProvenance({ ...EMPTY_STATE(), factRegistry: handoffRowsToRegistry(rows) }, factId);
    },

    async digestNow() {
      await startupCatchUp;
      const outcome = await maybeRunDigest({ db: store.db, userId: USER, scopeId, env: opts.env, reason: "explicit", digestLlm: opts.digestLlm });
      // … switch unchanged
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
```

The `recall` and `digestNow` bodies are copied from the current file with only the marked substitutions; do not retype the packing logic.

- [ ] **Step 2: Repoint the three remaining suites**

`embedded.test.ts` (the facetKey-collision test, lines 90-131): with `direct = await openStore(dir)`:

| Was | Becomes |
|---|---|
| `direct.prisma.projectScope.findFirstOrThrow({ where: { userId: "local", name: "/tmp/fake-project" } })` | `findScopeByName(direct.db, "/tmp/fake-project")!` |
| `direct.prisma.user.update({ where: { id: "local" }, data: { facetPack: {…} } })` | `setUserFacetPack(direct.db, "local", {…})` |
| `direct.prisma.digest.create({ data: { scopeId, summary: "collision-fixture", changes: "", nextSteps: [] } })` | `insertDigest(direct.db, { scopeId: scope.id, summary: "collision-fixture" })` |
| `direct.prisma.digestStateSnapshot.create({ data: { scopeId, digestId, state } })` | `insertSnapshot(direct.db, { scopeId: scope.id, digestId: digest.id, state })` |

`digest-now.test.ts` and `lib-export.test.ts`: same mapping as Task 4 Step 5 (`seedUser`, `seedScope`, `insertEvent`, `latestDigest`, `lockRows`), and `runScopeDigest({ prisma: store.prisma, … })` → `runScopeDigest({ db: store.db, … })`. `lib-export.test.ts`'s `listScopes` case seeds two scopes with `seedScope` and asserts the sorted names, as it already does.

- [ ] **Step 3: Run the whole package suite except e2e**

Run: `pnpm --filter statecore-mcp exec vitest run --exclude tests/e2e.test.ts --exclude tests/ddl-sync.test.ts`
Expected: PASS for every remaining file (`embedded`, `digest-now`, `lib-export`, `tools`, `instructions`, `scope`, `http-backend`, plus the Task 1–4 suites). `ddl-sync` and `e2e` are handled in Task 6.

- [ ] **Step 4: Type-check and commit**

```bash
pnpm --filter statecore-mcp exec tsc -p tsconfig.json --noEmit
git add apps/mcp/src/embedded.ts apps/mcp/tests/embedded.test.ts apps/mcp/tests/digest-now.test.ts apps/mcp/tests/lib-export.test.ts
git commit -m "refactor(mcp): embedded backend runs on node:sqlite"
```

---

### Task 6: package cleanup — drop Prisma, postinstall, Node floor, CI, ddl-sync and e2e

**Files:**
- Modify: `apps/mcp/package.json`, `apps/mcp/tsup.config.ts`
- Delete: `apps/mcp/scripts/postinstall.mjs`, `apps/mcp/scripts/prepare-publish.mjs`, `packages/db/lite-bootstrap.sql`
- Modify: `apps/mcp/tests/ddl-sync.test.ts`, `apps/mcp/tests/e2e.test.ts`
- Modify: `.github/workflows/ci.yml`, `CLAUDE.md`

- [ ] **Step 1: `package.json`**

Set exactly:

```json
"files": ["dist", "README.md", "server.json"],
"scripts": {
  "dev": "tsx --tsconfig ../../tsconfig.dev.json src/main.ts",
  "build": "tsup",
  "prebundle": "pnpm --filter @statecore/core --filter @statecore/prompts run build",
  "bundle": "tsup",
  "test": "vitest run",
  "prepublishOnly": "pnpm run bundle"
},
"engines": { "node": ">=22.13" },
"dependencies": {
  "@modelcontextprotocol/sdk": "^1.0.0",
  "zod": "^3.24.1"
},
"devDependencies": {
  "@statecore/core": "workspace:*",
  "@statecore/prompts": "workspace:*",
  "@types/node": "^22.0.0",
  "tsup": "^8.3.5",
  "tsx": "^4.19.2",
  "typescript": "^5.7.3",
  "vitest": "^2.1.9"
}
```

Then `rm apps/mcp/scripts/postinstall.mjs apps/mcp/scripts/prepare-publish.mjs` and `pnpm install` at the repo root (lockfile updates).

- [ ] **Step 2: `tsup.config.ts`**

Replace the long comment block and the two arrays with:

```ts
// `@statecore/core` and `@statecore/prompts` are inlined so the published
// bundle has no workspace dependency. The two runtime dependencies stay
// external and are declared in package.json. The store is `node:sqlite`, a
// Node builtin — nothing native to locate at runtime, nothing to generate at
// install time.
const noExternal = ["@statecore/core", "@statecore/prompts"];
const external = ["@modelcontextprotocol/sdk", "zod"];
```

and set `target: "node22"` in both `defineConfig` blocks.

- [ ] **Step 3: `ddl-sync.test.ts` reads migration 1**

Replace `const committed = readFileSync(resolve(dbRoot, "lite-bootstrap.sql"), "utf8");` with

```ts
import { MIGRATIONS } from "../src/migrations";
// …
const committed = MIGRATIONS[0].sql;
```

update the assertion message to name `apps/mcp/src/migrations.ts` (migration 1) instead of `packages/db/lite-bootstrap.sql`, then `git rm packages/db/lite-bootstrap.sql`. Update the file's header comment: both artifacts are still hand-maintained; `schema.lite.prisma` remains the documentation of the shape, migration 1 is what runs.

- [ ] **Step 4: `e2e.test.ts` source roots**

In `newestSourceMtime()` remove the two `packages/db/...` roots (the bundle no longer depends on them) and update the comment to name the two inlined packages.

- [ ] **Step 5: CI on Node 22 with the MCP suite**

In `.github/workflows/ci.yml`, change `node-version: 20` to `node-version: 22` in the test job, and add after "Run API tests":

```yaml
      - name: Run MCP tests
        run: pnpm --filter statecore-mcp test
```

In `CLAUDE.md` line 9 change `Node ≥20` to `Node ≥20 (apps/mcp: ≥22.13, it uses node:sqlite)`.

- [ ] **Step 6: Full suite, build, and a clean-install smoke**

```bash
pnpm --filter statecore-mcp test          # all suites incl. ddl-sync and e2e (e2e builds the bundle)
pnpm --filter statecore-mcp exec tsc -p tsconfig.json --noEmit
pnpm --filter statecore-mcp pack --pack-destination /tmp/sc-pack
```

Then, in a fresh directory with no repo access, prove the tarball installs and starts with scripts disabled:

```bash
cd "$(mktemp -d)" && npm init -y >/dev/null && npm install --ignore-scripts /tmp/sc-pack/statecore-mcp-*.tgz
printf '%s\n%s\n' '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"probe","version":"0"}}}' '{"jsonrpc":"2.0","method":"notifications/initialized"}' \
  | (cat; sleep 3) | npx statecore-mcp --data ./data 2>/dev/null | head -c 300
```

Expected: a JSON line containing `"serverInfo":{"name":"statecore","version":"0.6.0"}` and the `postinstall` step never runs (there is none). Delete the scratch directory.

- [ ] **Step 7: Commit**

```bash
git add -A apps/mcp packages/db/lite-bootstrap.sql .github/workflows/ci.yml CLAUDE.md pnpm-lock.yaml
git commit -m "build(mcp): drop Prisma and postinstall; Node >=22.13; CI runs the MCP suite on Node 22"
```

---

### Task 7: `export` subcommand

**Files:**
- Create: `apps/mcp/src/cli/export.ts`
- Modify: `apps/mcp/src/main.ts`
- Test: `apps/mcp/tests/export.test.ts`
- Modify: `apps/mcp/tests/e2e.test.ts` (one new case)

**Interfaces:**
- Produces:
  ```ts
  export interface ExportDocument {
    schemaVersion: number;
    exportedAt: string;
    scopes: Array<{
      id: string; name: string; template: string; createdAt: string;
      events: Array<{ id: string; type: string; source: string; key: string | null; content: string; createdAt: string; ingestedAt: string; suppressedAt: string | null; pinned: boolean }>;
      digests: Array<{ id: string; summary: string; changes: string; nextSteps: unknown; selectionLog: unknown; rebuildGroupId: string | null; createdAt: string }>;
      snapshots: Array<{ id: string; digestId: string; state: unknown; consistency: unknown; createdAt: string }>;
      handoffs: Array<{ id: string; content: string; createdAt: string; supersededBy: string | null; retiredAt: string | null; retiredReason: string | null }>;
      forgotten: Array<{ factKey: string; contentSnapshot: string; forgottenAt: string }>;
    }>;
  }
  export function buildExport(db: LiteDb, scopeName?: string): ExportDocument;
  export async function runExport(args: { dataDir: string; scopeName?: string }, out: (text: string) => void): Promise<void>;
  // main.ts
  export function parseArgs(argv: string[]): { dataDir?: string; url?: string; scope?: string };
  ```

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { openStore } from "../src/store";
import { buildExport, runExport } from "../src/cli/export";
import { CURRENT_SCHEMA_VERSION } from "../src/migrations";
import { seedUser, seedScope, insertEvent, insertDigest, insertSnapshot } from "./helpers/seed";

const iso = z.string().datetime();
const ExportSchema = z.object({
  schemaVersion: z.number().int().positive(),
  exportedAt: iso,
  scopes: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      template: z.string(),
      createdAt: iso,
      events: z.array(z.object({ id: z.string(), type: z.string(), source: z.string(), key: z.string().nullable(), content: z.string(), createdAt: iso, ingestedAt: iso, suppressedAt: iso.nullable(), pinned: z.boolean() })),
      digests: z.array(z.object({ id: z.string(), summary: z.string(), changes: z.string(), nextSteps: z.unknown(), selectionLog: z.unknown(), rebuildGroupId: z.string().nullable(), createdAt: iso })),
      snapshots: z.array(z.object({ id: z.string(), digestId: z.string(), state: z.unknown(), consistency: z.unknown(), createdAt: iso })),
      handoffs: z.array(z.object({ id: z.string(), content: z.string(), createdAt: iso, supersededBy: z.string().nullable(), retiredAt: iso.nullable(), retiredReason: z.string().nullable() })),
      forgotten: z.array(z.object({ factKey: z.string(), contentSnapshot: z.string(), forgottenAt: iso }))
    })
  )
});

describe("export", () => {
  it("buildExport dumps every scope with ISO dates and parsed JSON, and validates against the schema", async () => {
    const dir = mkdtempSync(join(tmpdir(), "sc-export-"));
    const store = await openStore(dir);
    seedUser(store.db);
    const a = seedScope(store.db, { name: "/proj/a" });
    const b = seedScope(store.db, { name: "/proj/b" });
    insertEvent(store.db, { scopeId: a.id, content: "hello a" });
    const digest = insertDigest(store.db, { scopeId: a.id, summary: "Notes", nextSteps: ["x"] });
    insertSnapshot(store.db, { scopeId: a.id, digestId: digest.id, state: { factRegistry: [] } });
    insertEvent(store.db, { scopeId: b.id, content: "hello b" });

    const doc = buildExport(store.db);
    expect(ExportSchema.parse(doc)).toBeTruthy();
    expect(doc.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect(doc.scopes.map((s) => s.name)).toEqual(["/proj/a", "/proj/b"]);
    expect(doc.scopes[0].events[0].content).toBe("hello a");
    expect(doc.scopes[0].digests[0].nextSteps).toEqual(["x"]);
    expect(doc.scopes[0].snapshots[0].state).toEqual({ factRegistry: [] });

    const only = buildExport(store.db, "/proj/b");
    expect(only.scopes.map((s) => s.name)).toEqual(["/proj/b"]);
    await store.close();
  });

  it("runExport writes the JSON document to the sink", async () => {
    const dir = mkdtempSync(join(tmpdir(), "sc-export-run-"));
    const store = await openStore(dir);
    seedUser(store.db);
    seedScope(store.db, { name: "/proj/only" });
    await store.close();
    let out = "";
    await runExport({ dataDir: dir }, (text) => (out += text));
    const parsed = ExportSchema.parse(JSON.parse(out));
    expect(parsed.scopes).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter statecore-mcp exec vitest run tests/export.test.ts`
Expected: FAIL — `Cannot find module '../src/cli/export'`.

- [ ] **Step 3: Implement `cli/export.ts`**

```ts
import { openStore } from "../store";
import type { LiteDb } from "../lite-db";
import { fromMs, fromMsNullable, parseJson, toBool } from "../rows";

export interface ExportDocument {
  schemaVersion: number;
  exportedAt: string;
  scopes: Array<{
    id: string;
    name: string;
    template: string;
    createdAt: string;
    events: Array<{ id: string; type: string; source: string; key: string | null; content: string; createdAt: string; ingestedAt: string; suppressedAt: string | null; pinned: boolean }>;
    digests: Array<{ id: string; summary: string; changes: string; nextSteps: unknown; selectionLog: unknown; rebuildGroupId: string | null; createdAt: string }>;
    snapshots: Array<{ id: string; digestId: string; state: unknown; consistency: unknown; createdAt: string }>;
    handoffs: Array<{ id: string; content: string; createdAt: string; supersededBy: string | null; retiredAt: string | null; retiredReason: string | null }>;
    forgotten: Array<{ factKey: string; contentSnapshot: string; forgottenAt: string }>;
  }>;
}

const isoOrNull = (v: number | null): string | null => fromMsNullable(v)?.toISOString() ?? null;

/**
 * A complete, self-describing dump of the embedded store: every scope (or one,
 * by name) with its events, digests, snapshots, handoffs and forgotten facts.
 * Dates are ISO-8601 strings and JSON columns are parsed, so the document is
 * readable without knowing the on-disk conventions. `schemaVersion` is the
 * store's `PRAGMA user_version` at export time.
 */
export function buildExport(db: LiteDb, scopeName?: string): ExportDocument {
  const scopes = scopeName
    ? db.all<{ id: string; name: string; template: string; createdAt: number }>(`SELECT "id", "name", "template", "createdAt" FROM "ProjectScope" WHERE "name" = ? ORDER BY "name"`, scopeName)
    : db.all<{ id: string; name: string; template: string; createdAt: number }>(`SELECT "id", "name", "template", "createdAt" FROM "ProjectScope" ORDER BY "name"`);
  return {
    schemaVersion: db.userVersion(),
    exportedAt: new Date().toISOString(),
    scopes: scopes.map((scope) => ({
      id: scope.id,
      name: scope.name,
      template: scope.template,
      createdAt: fromMs(scope.createdAt).toISOString(),
      events: db
        .all<{ id: string; type: string; source: string; key: string | null; content: string; createdAt: number; ingestedAt: number; suppressedAt: number | null; pinned: number }>(
          `SELECT "id", "type", "source", "key", "content", "createdAt", "ingestedAt", "suppressedAt", "pinned" FROM "MemoryEvent" WHERE "scopeId" = ? ORDER BY "createdAt", "id"`,
          scope.id
        )
        .map((e) => ({ ...e, createdAt: fromMs(e.createdAt).toISOString(), ingestedAt: fromMs(e.ingestedAt).toISOString(), suppressedAt: isoOrNull(e.suppressedAt), pinned: toBool(e.pinned) })),
      digests: db
        .all<{ id: string; summary: string; changes: string; nextSteps: string; selectionLog: string | null; rebuildGroupId: string | null; createdAt: number }>(
          `SELECT "id", "summary", "changes", "nextSteps", "selectionLog", "rebuildGroupId", "createdAt" FROM "Digest" WHERE "scopeId" = ? ORDER BY "createdAt", "id"`,
          scope.id
        )
        .map((d) => ({ ...d, nextSteps: parseJson<unknown>(d.nextSteps, []), selectionLog: parseJson<unknown>(d.selectionLog, null), createdAt: fromMs(d.createdAt).toISOString() })),
      snapshots: db
        .all<{ id: string; digestId: string; state: string; consistency: string | null; createdAt: number }>(
          `SELECT "id", "digestId", "state", "consistency", "createdAt" FROM "DigestStateSnapshot" WHERE "scopeId" = ? ORDER BY "createdAt", "id"`,
          scope.id
        )
        .map((s) => ({ ...s, state: parseJson<unknown>(s.state, null), consistency: parseJson<unknown>(s.consistency, null), createdAt: fromMs(s.createdAt).toISOString() })),
      handoffs: db
        .all<{ id: string; content: string; createdAt: number; supersededBy: string | null; retiredAt: number | null; retiredReason: string | null }>(
          `SELECT "id", "content", "createdAt", "supersededBy", "retiredAt", "retiredReason" FROM "SessionHandoff" WHERE "scopeId" = ? ORDER BY "createdAt", "id"`,
          scope.id
        )
        .map((h) => ({ ...h, createdAt: fromMs(h.createdAt).toISOString(), retiredAt: isoOrNull(h.retiredAt) })),
      forgotten: db
        .all<{ factKey: string; contentSnapshot: string; forgottenAt: number }>(
          `SELECT "factKey", "contentSnapshot", "forgottenAt" FROM "ForgottenFact" WHERE "scopeId" = ? ORDER BY "forgottenAt"`,
          scope.id
        )
        .map((f) => ({ ...f, forgottenAt: fromMs(f.forgottenAt).toISOString() }))
    }))
  };
}

/** `statecore-mcp export [--data <dir>] [--scope <name>]`: writes the document as pretty JSON to `out`. */
export async function runExport(args: { dataDir: string; scopeName?: string }, out: (text: string) => void): Promise<void> {
  const store = await openStore(args.dataDir);
  try {
    out(JSON.stringify(buildExport(store.db, args.scopeName), null, 2) + "\n");
  } finally {
    await store.close();
  }
}
```

- [ ] **Step 4: Subcommand dispatch in `main.ts`**

Extend `parseArgs` to also read `--scope <name>` into `out.scope`, and replace `main()`:

```ts
import { runExport } from "./cli/export";

const SUBCOMMANDS = ["export"] as const;
type Subcommand = (typeof SUBCOMMANDS)[number];

function isSubcommand(value: string | undefined): value is Subcommand {
  return (SUBCOMMANDS as readonly string[]).includes(value ?? "");
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const defaultDataDir = join(homedir(), ".statecore");

  if (isSubcommand(argv[0])) {
    const args = parseArgs(argv.slice(1));
    if (argv[0] === "export") {
      await runExport({ dataDir: args.dataDir ?? defaultDataDir, scopeName: args.scope }, (text) => process.stdout.write(text));
    }
    return;
  }

  const args = parseArgs(argv);
  const backend = resolveBackend(args, process.env);
  await backend.init();
  const server = createServer(backend, pkg.version);
  await server.connect(new StdioServerTransport());
  console.error(`[statecore-mcp] ready over stdio (${args.url ? `remote ${args.url}` : `embedded ${args.dataDir ?? defaultDataDir}`})`);
}
```

- [ ] **Step 5: e2e case for the built binary**

Add to `e2e.test.ts` (inside the existing describe, after the tools test):

```ts
  it("`export` prints a schema-versioned JSON dump of the same data dir", async () => {
    await client.callTool({ name: "remember", arguments: { text: "export probe fact" } });
    const { execFileSync } = await import("node:child_process");
    const out = execFileSync(distEntry, ["export", "--data", dataDir], { encoding: "utf8", env: { ...getDefaultEnvironment(), STATECORE_SCOPE: "e2e-scope" } });
    const doc = JSON.parse(out) as { schemaVersion: number; scopes: Array<{ name: string; snapshots: Array<{ state: { factRegistry: Array<{ content: string }> } }> }> };
    expect(doc.schemaVersion).toBeGreaterThanOrEqual(1);
    const scope = doc.scopes.find((s) => s.name === "e2e-scope")!;
    expect(scope.snapshots.at(-1)!.state.factRegistry.some((f) => f.content.includes("export probe fact"))).toBe(true);
  });
```

- [ ] **Step 6: Run tests**

Run: `pnpm --filter statecore-mcp exec vitest run tests/export.test.ts tests/e2e.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/mcp/src/cli/export.ts apps/mcp/src/main.ts apps/mcp/tests/export.test.ts apps/mcp/tests/e2e.test.ts
git commit -m "feat(mcp): export subcommand dumps the store as schema-versioned JSON"
```

---

### Task 8: cross-process concurrency smoke

**Files:**
- Modify: `apps/mcp/tests/e2e.test.ts`

- [ ] **Step 1: Add the test**

A second built-binary client on the same data dir and scope, both writing notes at once; afterwards every note is visible from either client:

```ts
  it("two processes writing the same scope both succeed (WAL + busy timeout)", async () => {
    const other = new Client({ name: "e2e-second", version: "0.0.0-test" });
    const otherTransport = new StdioClientTransport({ command: distEntry, args: ["--data", dataDir], env: { ...getDefaultEnvironment(), STATECORE_SCOPE: "e2e-scope" } });
    await other.connect(otherTransport);
    try {
      await Promise.all(
        Array.from({ length: 10 }, (_, i) => [
          client.callTool({ name: "remember", arguments: { text: `concurrent A${i} distinct-token-alpha-${i}` } }),
          other.callTool({ name: "remember", arguments: { text: `concurrent B${i} distinct-token-beta-${i}` } })
        ]).flat()
      );
      const result = (await other.callTool({ name: "facts", arguments: {} })) as { content: Array<{ text: string }> };
      const text = result.content.map((c) => c.text).join("\n");
      for (let i = 0; i < 10; i++) {
        expect(text).toContain(`distinct-token-alpha-${i}`);
        expect(text).toContain(`distinct-token-beta-${i}`);
      }
    } finally {
      await other.close();
    }
  }, 60_000);
```

- [ ] **Step 2: Run**

Run: `pnpm --filter statecore-mcp exec vitest run tests/e2e.test.ts`
Expected: PASS. If a `SQLITE_BUSY` surfaces, the busy timeout is not being applied — re-check `openLiteDb` runs `PRAGMA busy_timeout = 5000` before any write. Note: the note path (`remember` without `consolidate`) rewrites the snapshot row inside one statement per call, so the last writer of concurrent same-snapshot edits could drop the other's note; if this test shows a missing token, wrap the note path's read-modify-write in `store.db.transaction` (BEGIN IMMEDIATE serializes it) in `embedded.ts` and re-run.

- [ ] **Step 3: Commit**

```bash
git add apps/mcp/tests/e2e.test.ts apps/mcp/src/embedded.ts
git commit -m "test(mcp): cross-process concurrent writes to one scope"
```

---

### Task 9: docs, stability promise, changeset

**Files:**
- Modify: `apps/mcp/README.md`, `STABILITY.md`
- Create: `.changeset/mcp-node-sqlite.md`

- [ ] **Step 1: README**

In `apps/mcp/README.md`:
- Under "## Modes", after the Embedded paragraph, add:
  > Requires Node 22.13 or newer: the embedded store is Node's built-in `node:sqlite`, so installing pulls no native module and runs no install script. The file is `~/.statecore/statecore.db` (or `--data <dir>/statecore.db`).
- Under "## Limitations", replace the third bullet's parenthetical with "(WAL, a 5 s busy timeout, and an in-database digest lock for concurrent distillation)".
- Add a new section before "## More":
  ```markdown
  ## Data file compatibility

  The store carries its schema version in `PRAGMA user_version`. Any 1.x release
  of `statecore-mcp` opens a database created by any earlier 1.x or 0.6.x release
  and upgrades it in place on open; downgrading to an older release is not
  supported. To take your data elsewhere:

  ```bash
  statecore-mcp export --data ~/.statecore > statecore-export.json   # all scopes
  statecore-mcp export --scope /path/to/project                       # one scope
  ```

  The document is pretty-printed JSON with ISO-8601 dates, parsed JSON columns,
  and a top-level `schemaVersion`.
  ```

- [ ] **Step 2: STABILITY.md**

Append a section:

```markdown
## statecore-mcp data files

`statecore-mcp`'s embedded SQLite store is versioned with `PRAGMA user_version`
and migrated forward on open. Every 1.x release opens files written by any
earlier 1.x or 0.6.x release. Downgrades are unsupported. `statecore-mcp export`
produces a schema-versioned JSON dump.
```

- [ ] **Step 3: Changeset**

`.changeset/mcp-node-sqlite.md`:

```markdown
---
"statecore-mcp": minor
---

The embedded store now runs on Node's built-in `node:sqlite` instead of Prisma.

- No `postinstall`, no native module, no engine download: `npm install --ignore-scripts` and pnpm 10's default script blocking both work.
- Requires Node 22.13 or newer.
- The database file is schema-versioned (`PRAGMA user_version`) and migrated in place on open; 0.6.x files open unchanged.
- New `statecore-mcp export [--data <dir>] [--scope <name>]` prints a JSON dump.
- `runScopeDigest`'s first option is now `db` (was `prisma`). `createEmbeddedBackend`, `createHttpBackend`, `listScopes`, `resolveScopeName` are unchanged.
```

- [ ] **Step 4: Final verification and commit**

```bash
pnpm --filter statecore-mcp test
pnpm lint
git add apps/mcp/README.md STABILITY.md .changeset/mcp-node-sqlite.md
git commit -m "docs(mcp): node:sqlite store, data-file compatibility, export; changeset for 0.7.0"
```

Then open a PR from `mcp-storage-foundation` to `main`. Publishing `0.7.0` (`GITHUB_TOKEN="$(gh auth token)" pnpm exec changeset version`, then `pnpm --filter statecore-mcp publish`) happens after merge and is the user's call.
