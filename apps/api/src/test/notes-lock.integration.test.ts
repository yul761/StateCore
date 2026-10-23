import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import request from "supertest";
import type { INestApplication } from "@nestjs/common";
import { createTestApp } from "./setup";
import { clearDatabase } from "./helpers";

const USER = "notes-lock-user";

// Note writes, forgets and digest writes each read-modify-write the scope's
// latest snapshot. Postgres runs them at READ COMMITTED without a row lock, so
// they take the scope's advisory lock (scope-lock.ts); these cover that path
// against a real database.
describe("note writes under the scope lock", () => {
  let app: INestApplication;
  beforeAll(async () => { app = await createTestApp(); }, 30000);
  beforeEach(async () => { await clearDatabase(); });
  afterAll(async () => { await app.close(); });

  async function seedScope(): Promise<string> {
    const res = await request(app.getHttpServer()).post("/scopes").set("x-user-id", USER).send({ name: "s" });
    expect(res.status).toBe(201);
    return res.body.id as string;
  }

  const noteTexts = async (scopeId: string): Promise<string[]> => {
    const res = await request(app.getHttpServer()).get(`/v1/memory/facts?scopeId=${scopeId}`).set("x-user-id", USER);
    expect(res.status).toBe(200);
    return (res.body.groups ?? res.body).flatMap((g: any) => g.items).map((i: any) => i.text);
  };

  it("concurrent note writes are all kept", async () => {
    const scopeId = await seedScope();
    // The first write creates the snapshot; the rest race on it.
    await request(app.getHttpServer()).post("/v1/memory/notes").set("x-user-id", USER).send({ scopeId, text: "seed note zero" });
    const topics = ["amber", "basil", "cedar", "delta", "ember", "fjord", "gable", "heron"];
    const results = await Promise.all(
      topics.map((t) =>
        request(app.getHttpServer()).post("/v1/memory/notes").set("x-user-id", USER).send({ scopeId, text: `${t} ${t} ${t} distinct note` })
      )
    );
    expect(results.every((r) => r.status === 201)).toBe(true);

    const texts = await noteTexts(scopeId);
    for (const t of topics) expect(texts).toContain(`${t} ${t} ${t} distinct note`);
    expect(texts).toContain("seed note zero");
  });

  it("forget then a revised note links the two on the provenance chain", async () => {
    const scopeId = await seedScope();
    await request(app.getHttpServer()).post("/v1/memory/notes").set("x-user-id", USER).send({ scopeId, text: "[decision:db] 用 PostgreSQL 存储会话" });
    const facts = await request(app.getHttpServer()).get(`/v1/memory/facts?scopeId=${scopeId}`).set("x-user-id", USER);
    const old = (facts.body.groups ?? facts.body).flatMap((g: any) => g.items)[0];
    const forgot = await request(app.getHttpServer()).post("/v1/memory/facts/forget").set("x-user-id", USER).send({ scopeId, factKey: old.factKey });
    expect(forgot.status).toBe(201);
    await request(app.getHttpServer()).post("/v1/memory/notes").set("x-user-id", USER).send({ scopeId, text: "[decision:db] 用 MySQL 存储会话" });

    const after = await request(app.getHttpServer()).get(`/v1/memory/facts?scopeId=${scopeId}`).set("x-user-id", USER);
    const items = (after.body.groups ?? after.body).flatMap((g: any) => g.items);
    expect(items.map((i: any) => i.text)).toEqual(["[decision:db] 用 MySQL 存储会话"]);
    const prov = await request(app.getHttpServer())
      .get(`/v1/memory/facts/${items[0].factId}/provenance?scopeId=${scopeId}`)
      .set("x-user-id", USER);
    expect(prov.status).toBe(200);
    expect(prov.body.chain.map((e: any) => e.content)).toEqual(["[decision:db] 用 PostgreSQL 存储会话", "[decision:db] 用 MySQL 存储会话"]);
  });
});
