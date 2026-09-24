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
