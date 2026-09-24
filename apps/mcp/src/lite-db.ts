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
 * busy_timeout is set before the journal_mode switch: converting to WAL
 * itself takes a lock, and a concurrent writer already holding it should be
 * waited out under the same timeout rather than failing the conversion
 * immediately.
 */
export function openLiteDb(path: string, migrations: Migration[] = MIGRATIONS): LiteDb {
  const db = new NodeSqliteDb(new DatabaseSync(path));
  db.exec("PRAGMA busy_timeout = 5000");
  db.exec("PRAGMA journal_mode = WAL");
  applyMigrations(db, migrations);
  return db;
}
