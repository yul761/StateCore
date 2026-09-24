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
