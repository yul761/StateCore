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
