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
