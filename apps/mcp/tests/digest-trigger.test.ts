import { describe, it, expect, vi } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { shouldDigest, acquireDigestLock, releaseDigestLock, maybeRunDigest, countPendingEvents, hasUsableModel } from "../src/digest";
import { openStore } from "../src/store";
import { seedUser, seedScope, insertEvent, insertDigest } from "./helpers/seed";

describe("digest trigger", () => {
  it("fires only at/over threshold", () => {
    expect(shouldDigest(19, 20)).toBe(false);
    expect(shouldDigest(20, 20)).toBe(true);
  });

  it("second lock acquisition on the same scope fails until released", async () => {
    const dir = mkdtempSync(join(tmpdir(), "sc-mcp-lock-"));
    const store = await openStore(dir);
    try {
      const scopeId = "scope-under-lock";
      expect(await acquireDigestLock(store.db, scopeId)).toBe(true);
      expect(await acquireDigestLock(store.db, scopeId)).toBe(false);
      await releaseDigestLock(store.db, scopeId);
      expect(await acquireDigestLock(store.db, scopeId)).toBe(true);
    } finally {
      await store.close();
    }
  });

  // Regression for a Critical review finding: maybeRunDigest's pending-count
  // reads (db.get for the last digest, db.get for the pending count) ran
  // before its try/catch, and both embedded.ts call sites invoke it
  // fire-and-forget (`void maybeRunDigest(...)`) — a rejection there was an
  // unhandled promise rejection, which crashes the process on modern Node. A
  // stubbed db whose very first call (get) throws reaches that pre-lock path
  // without a real LLM call ever happening.
  it("never rejects, even when a pre-lock db read fails", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const failingDb = {
        get: () => {
          throw new Error("database is locked");
        }
      } as any;

      await expect(
        maybeRunDigest({
          db: failingDb,
          userId: "local",
          scopeId: "scope-boom",
          env: { FEATURE_LLM: "true", MODEL_API_KEY: "test-key" } as any,
          reason: "threshold"
        })
      ).resolves.toBe("failed"); // resolves (never rejects), reporting the failure as an outcome

      expect(errorSpy).toHaveBeenCalledWith("[statecore-mcp] digest run failed", expect.any(Error));
    } finally {
      errorSpy.mockRestore();
    }
  });
});

describe("countPendingEvents", () => {
  it("counts unsuppressed stream events newer than the latest digest and reports the oldest", async () => {
    const dir = mkdtempSync(join(tmpdir(), "sc-pending-"));
    const store = await openStore(dir);
    seedUser(store.db);
    const scope = seedScope(store.db, { name: "/p" });
    expect(countPendingEvents(store.db, scope.id)).toEqual({ events: 0, oldest: null });
    insertEvent(store.db, { scopeId: scope.id, content: "old", createdAt: new Date(1_000) });
    const digest = insertDigest(store.db, { scopeId: scope.id, summary: "d" });
    // insertDigest stamps createdAt = now; events after it are pending
    insertEvent(store.db, { scopeId: scope.id, content: "new-1", createdAt: new Date(Date.now() + 10) });
    insertEvent(store.db, { scopeId: scope.id, content: "new-2", createdAt: new Date(Date.now() + 20) });
    const pending = countPendingEvents(store.db, scope.id);
    expect(pending.events).toBe(2);
    expect(typeof pending.oldest).toBe("number");
    void digest;
    await store.close();
  });
});

describe("hasUsableModel", () => {
  it("is true with an injected model or FEATURE_LLM + key, false otherwise", () => {
    expect(hasUsableModel({}, { chat: async () => "" })).toBe(true);
    expect(hasUsableModel({ FEATURE_LLM: "true", MODEL_API_KEY: "k" })).toBe(true);
    expect(hasUsableModel({ FEATURE_LLM: "true", MODEL_STRUCTURED_OUTPUT_API_KEY: "k" })).toBe(true);
    expect(hasUsableModel({ FEATURE_LLM: "true" })).toBe(false);
    expect(hasUsableModel({ MODEL_API_KEY: "k" })).toBe(false);
    expect(hasUsableModel({})).toBe(false);
  });
});
