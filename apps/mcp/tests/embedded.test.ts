import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createEmbeddedBackend } from "../src/embedded";
import { openStore } from "../src/store";
import { clearFacetPackCache, type DigestState } from "@statecore/core";
import { findScopeByName, setUserFacetPack, insertDigest, insertSnapshot, insertEvent } from "./helpers/seed";
import type { DigestChatModel } from "../src/digest";

describe("embedded backend, keyless", () => {
  const dir = mkdtempSync(join(tmpdir(), "sc-emb-"));
  const be = createEmbeddedBackend({ dataDir: dir, scopeName: "/tmp/fake-project", env: {} as any });
  beforeAll(() => be.init());
  afterAll(() => be.close());

  it("remember(note) → facts → why yields an evidence chain without any LLM", async () => {
    await be.remember({ text: "We use pnpm, not npm" });
    const groups: any = await be.facts();
    const all = groups.flatMap((g: any) => g.items);
    expect(all.some((f: any) => f.text.includes("pnpm"))).toBe(true);
    const factId = all.find((f: any) => f.text.includes("pnpm")).factId;
    const prov: any = await be.why({ factId });
    expect(prov.fact.content).toContain("pnpm");
    expect(prov.fact.evidenceId).toBeTruthy();
    expect(prov.chain.length).toBeGreaterThanOrEqual(1);
  });

  it("forget removes the fact from facts() but retires rather than deletes", async () => {
    await be.remember({ text: "Temporary secret preference" });
    const before: any = await be.facts();
    const target = before.flatMap((g: any) => g.items).find((f: any) => f.text.includes("Temporary"));
    await be.forget({ factKey: target.factKey });
    const after: any = await be.facts();
    expect(after.flatMap((g: any) => g.items).some((f: any) => f.factKey === target.factKey)).toBe(false);
  });

  it("recall respects a maxChars budget and reports it", async () => {
    const out: any = await be.recall({ query: "pnpm", maxChars: 500 });
    expect(out.budget?.maxChars).toBe(500);
  });

  it("remember(consolidate) stores a stream event and never throws keyless", async () => {
    const res = await be.remember({ text: "long conversational turn …", consolidate: true });
    expect(res.mode).toBe("event");
  });

  it("handoff → recall returns it; a second supersedes the first; why() walks the chain; clear retires", async () => {
    const first = await be.handoff({ summary: "stopped mid-migration", nextSteps: ["wire the controller"] });
    expect(first).toMatchObject({ ok: true, superseded: false });
    expect(first.handoffId).toBeTruthy();

    const afterFirst: any = await be.recall({});
    expect(afterFirst.handoff?.content).toContain("stopped mid-migration");
    expect(afterFirst.handoff?.content).toContain("wire the controller");
    expect(afterFirst.handoff?.id).toBe(first.handoffId);
    // The handoff rides only in its own field: duplicating it into factRegistry
    // would also let it compete for the maxChars budget it is promised out of.
    expect((afterFirst.factRegistry as any[]).some((f) => f.facet === "handoff")).toBe(false);

    const second = await be.handoff({ summary: "controller wired, tests failing", openQuestions: ["flaky or real?"] });
    expect(second).toMatchObject({ ok: true, superseded: true });

    const afterSecond: any = await be.recall({ query: "controller" });
    expect(afterSecond.handoff?.content).toContain("tests failing");
    expect(afterSecond.handoff?.versionCount).toBe(2);

    // The chain is walkable through the same why() every fact uses.
    const prov: any = await be.why({ factId: second.handoffId! });
    expect(prov.chain.map((e: any) => e.id)).toEqual([first.handoffId, second.handoffId]);

    // clear retires (never deletes): recall stops carrying it, history remains.
    const cleared = await be.handoff({ clear: true });
    expect(cleared).toMatchObject({ ok: true, cleared: true });
    const afterClear: any = await be.recall({});
    expect(afterClear.handoff).toBeNull();
    const provAfterClear: any = await be.why({ factId: second.handoffId! });
    expect(provAfterClear.fact.retiredReason).toBe("user_cleared");
  });

  it("capture stores an externally captured message as a keyed stream event, once", async () => {
    const first = await be.capture!({ text: "user said: switch the build to turbo", key: "cc:sess-1:p-1:user" });
    expect(first).toMatchObject({ ok: true, stored: true });
    expect(first.eventId).toBeTruthy();
    const again = await be.capture!({ text: "user said: switch the build to turbo", key: "cc:sess-1:p-1:user" });
    expect(again).toEqual({ ok: true, stored: false, eventId: first.eventId });

    const direct = await openStore(dir);
    try {
      const row = direct.db.get<{ type: string; source: string; key: string; content: string }>(
        `SELECT "type", "source", "key", "content" FROM "MemoryEvent" WHERE "id" = ?`,
        first.eventId!
      );
      expect(row).toEqual({ type: "stream", source: "cli", key: "cc:sess-1:p-1:user", content: "user said: switch the build to turbo" });
      const scope = findScopeByName(direct.db, "/tmp/fake-project")!;
      const count = direct.db.get<{ n: number }>(
        `SELECT COUNT(*) AS n FROM "MemoryEvent" WHERE "key" = ? AND "scopeId" = ?`,
        "cc:sess-1:p-1:user",
        scope.id
      )!.n;
      expect(count).toBe(1);
    } finally {
      await direct.close();
    }
  });

  // capture()'s up-front SELECT and its INSERT are not atomic against
  // MemoryEvent_scopeId_key_key: a second connection can insert the same
  // (scopeId, key) row between the two. The deterministic, non-flaky way to
  // exercise the "row already exists" half of that race without an actual
  // 5s-busy_timeout SQLITE_BUSY collision (which the suite must not pay for)
  // is to pre-insert the keyed row through a second store connection before
  // calling capture(): capture()'s lookup then finds it and returns
  // `stored: false` with the pre-inserted row's id, exactly as it would for
  // the winning side of a real race. The retry-after-a-thrown-error branch in
  // embedded.ts (SQLITE_BUSY / "database is locked" / UNIQUE constraint
  // regexp) is covered by that code's own reasoning rather than a forced
  // race here — see the comment on `capture` in src/embedded.ts.
  it("capture returns stored: false when another connection already inserted the keyed row (the race's lookup half)", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "sc-emb-race-"));
    const be = createEmbeddedBackend({ dataDir, scopeName: "/tmp/fake-race-project", env: {} as any });
    await be.init();
    try {
      const direct = await openStore(dataDir);
      let racedInId: string;
      try {
        const scope = findScopeByName(direct.db, "/tmp/fake-race-project")!;
        racedInId = insertEvent(direct.db, { scopeId: scope.id, content: "raced in by another connection", key: "cc:race:1:user" }).id;
      } finally {
        await direct.close();
      }

      const result = await be.capture!({ text: "raced in by another connection", key: "cc:race:1:user" });
      expect(result).toEqual({ ok: true, stored: false, eventId: racedInId });
    } finally {
      await be.close();
    }
  });

  it("captured events are recallable through the token index", async () => {
    await be.capture!({ text: "assistant said: the zephyr-widget module owns retries", key: "cc:sess-1:p-2:assistant" });
    const out: any = await be.recall({ query: "zephyr-widget" });
    expect(out.events.some((e: any) => e.content.includes("zephyr-widget"))).toBe(true);
  });

  // Regression for a first-wins vs. last-wins factId join bug: two registry
  // entries in different facets that share a displayGroup and normalize to the
  // same content collide on the same factKey (computeFactKey hashes
  // displayGroup + normalized content, not facet). flattenScopeFacts resolves
  // that collision first-registered-entry-wins; attachFactIds (embedded.ts)
  // must resolve it the same way, or why(factId) returns provenance for the
  // wrong registry entry. Reaches the collision by installing a custom facet
  // pack with two same-group facets and writing a snapshot directly, since the
  // real "project" pack this backend otherwise uses has no two facets sharing a
  // displayGroup.
  it("facts()/why() resolve a same-displayGroup factKey collision to the first-registered entry", async () => {
    const direct = await openStore(dir);
    try {
      const scope = findScopeByName(direct.db, "/tmp/fake-project")!;
      setUserFacetPack(direct.db, "local", {
        name: "collide-test",
        facets: [
          { name: "a", displayGroup: "Collide", cap: 8, writeProtected: false, description: "a" },
          { name: "b", displayGroup: "Collide", cap: 8, writeProtected: false, description: "b" }
        ]
      });
      clearFacetPackCache("local");

      const digest = insertDigest(direct.db, { scopeId: scope.id, summary: "collision-fixture" });
      const state: DigestState = {
        stableFacts: { decisions: [] },
        workingNotes: {},
        todos: [],
        factRegistry: [
          { id: "reg-a", content: "Same fact text", type: "profile", confidence: 0.9, addedAt: "2024-01-01T00:00:00.000Z", evidenceId: "ev-a", evidenceType: "event", facet: "a" },
          { id: "reg-b", content: "same fact text", type: "profile", confidence: 0.9, addedAt: "2024-01-02T00:00:00.000Z", evidenceId: "ev-b", evidenceType: "event", facet: "b" }
        ],
        profile: {}
      };
      insertSnapshot(direct.db, { scopeId: scope.id, digestId: digest.id, state });

      const groups: any = await be.facts();
      const collided = groups.flatMap((g: any) => g.items).filter((f: any) => f.text.toLowerCase() === "same fact text");
      expect(collided.length).toBe(1); // merged by flattenScopeFacts' factKey dedup
      expect(collided[0].factId).toBe("reg-a"); // first-registered entry wins, not last

      const prov: any = await be.why({ factId: collided[0].factId });
      expect(prov.fact.evidenceId).toBe("ev-a");
    } finally {
      await direct.close();
    }
  });
});

/** Minimal DigestOutputSchema-valid stage-2 response, copied from
 * tests/digest-now.test.ts's STAGE2_OUTPUT (see that file for the schema
 * constraints that make this the smallest valid answer). */
const STAGE2_OUTPUT = {
  summary: "The scope digested during a backgroundDigest test.",
  changes: ["Recorded a new stream event."],
  nextSteps: ["Continue monitoring incoming events."],
  profileFacts: []
};

function makeStubLlm(): DigestChatModel {
  return { chat: vi.fn(async () => JSON.stringify(STAGE2_OUTPUT)) };
}

describe("createEmbeddedBackend({ backgroundDigest })", () => {
  it("false: capture/consolidate-remember never trigger a digest, even past threshold, and close() does not wait on one", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "sc-emb-bg-off-"));
    const llm = makeStubLlm();
    const env = { STATECORE_DIGEST_THRESHOLD: "1" } as unknown as NodeJS.ProcessEnv;

    const be = createEmbeddedBackend({ dataDir, scopeName: "/tmp/bg-digest-off", env, digestLlm: llm, backgroundDigest: false });
    await be.init();
    await be.capture({ text: "first captured event", key: "k1" });
    await be.capture({ text: "second captured event", key: "k2" });
    await be.remember({ text: "a consolidate-mode event", consolidate: true });
    await be.close();

    expect(llm.chat).not.toHaveBeenCalled();

    // A second backend on the same store, still opted out, makes the pending
    // backlog explicit via digestNow() instead — the one distillation moment
    // left for a backgroundDigest: false caller (cli/hook.ts's pre-compact).
    const be2 = createEmbeddedBackend({ dataDir, scopeName: "/tmp/bg-digest-off", env, digestLlm: llm, backgroundDigest: false });
    await be2.init();
    const outcome = await be2.digestNow();
    expect(outcome).toEqual({ ran: true });
    expect(llm.chat).toHaveBeenCalled();
    await be2.close();
  });

  it("default (omitted): a consolidate-remember crossing threshold drives the digest in the background, done by the time close() resolves", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "sc-emb-bg-default-"));
    const llm = makeStubLlm();
    const env = { STATECORE_DIGEST_THRESHOLD: "1" } as unknown as NodeJS.ProcessEnv;

    const be = createEmbeddedBackend({ dataDir, scopeName: "/tmp/bg-digest-default", env, digestLlm: llm });
    await be.init();
    await be.remember({ text: "a consolidate-mode event", consolidate: true });
    await be.close();

    expect(llm.chat).toHaveBeenCalled();
  });
});
