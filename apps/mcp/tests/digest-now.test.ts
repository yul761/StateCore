// MemoryBackend.digestNow — the caller-demanded, threshold-1 digest pass a
// host invokes at the moment raw context is about to leave a model's view
// (dsh-statecore's compaction consumer is the motivating caller). Covers the
// honest-outcome union across both backends: embedded runs with a single
// pending event (below the normal threshold), reports the keyless gate and
// the nothing-pending gate, and the http backend reports "unsupported"
// because the frozen /v1 surface exposes no digest trigger.
import { describe, it, expect, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createEmbeddedBackend, createHttpBackend, type DigestChatModel } from "../src/lib";
import { openStore } from "../src/store";
import { countRows, latestDigest } from "./helpers/seed";

/** Minimal DigestOutputSchema-valid stage-2 response, copied from
 * tests/lib-export.test.ts's STAGE2_OUTPUT (see that file for the schema
 * constraints that make this the smallest valid answer). */
const STAGE2_OUTPUT = {
  summary: "The scope digested a single pending event on explicit demand.",
  changes: ["Recorded one new stream event."],
  nextSteps: ["Continue monitoring incoming events."],
  profileFacts: []
};

function makeStubLlm(): { llm: DigestChatModel; callCount: () => number } {
  let calls = 0;
  return {
    llm: {
      chat: async () => {
        calls += 1;
        return JSON.stringify(STAGE2_OUTPUT);
      }
    },
    callCount: () => calls
  };
}

describe("MemoryBackend.digestNow", () => {
  it("embedded + injected llm: one pending event (below the normal threshold) digests immediately with {ran: true}", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "sc-mcp-digestnow-ran-"));
    const { llm, callCount } = makeStubLlm();
    const backend = createEmbeddedBackend({
      dataDir,
      scopeName: "/tmp/digest-now-project",
      // Threshold 20 (the default) would never fire for one event — that gap
      // is exactly what digestNow exists to close.
      env: { STATECORE_DIGEST_THRESHOLD: "20" } as unknown as NodeJS.ProcessEnv,
      digestLlm: llm
    });
    try {
      await backend.init();
      // Drains the startup catch-up deterministically (digestNow awaits it)
      // BEFORE the event lands, so the catch-up's threshold-1 pass can never
      // race digestNow for the event seeded next.
      expect(await backend.digestNow()).toEqual({ ran: false, reason: "below-threshold" });

      await backend.remember({ text: "we decided to compact", consolidate: true });

      const result = await backend.digestNow();

      expect(result).toEqual({ ran: true });
      expect(callCount()).toBe(1);
      const store = await openStore(dataDir);
      try {
        const digestRow = latestDigest(store.db);
        expect(digestRow?.summary).toBe(STAGE2_OUTPUT.summary);
      } finally {
        await store.close();
      }
    } finally {
      await backend.close();
      rmSync(dataDir, { recursive: true, force: true });
    }
  });

  it("embedded + injected llm, nothing pending: {ran: false, reason: 'below-threshold'} and no llm call", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "sc-mcp-digestnow-empty-"));
    const { llm, callCount } = makeStubLlm();
    const backend = createEmbeddedBackend({
      dataDir,
      scopeName: "/tmp/digest-now-empty-project",
      env: {} as unknown as NodeJS.ProcessEnv,
      digestLlm: llm
    });
    try {
      await backend.init();

      const result = await backend.digestNow();

      expect(result).toEqual({ ran: false, reason: "below-threshold" });
      expect(callCount()).toBe(0);
    } finally {
      await backend.close();
      rmSync(dataDir, { recursive: true, force: true });
    }
  });

  it("embedded, keyless, no injected llm: {ran: false, reason: 'no-llm'} even with a pending event", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "sc-mcp-digestnow-keyless-"));
    const backend = createEmbeddedBackend({
      dataDir,
      scopeName: "/tmp/digest-now-keyless-project",
      env: {} as unknown as NodeJS.ProcessEnv
    });
    try {
      await backend.init();
      await backend.remember({ text: "pending but keyless", consolidate: true });

      const result = await backend.digestNow();

      expect(result).toEqual({ ran: false, reason: "no-llm" });
    } finally {
      await backend.close();
      rmSync(dataDir, { recursive: true, force: true });
    }
  });

  it("embedded: stage 2 returning nothing parseable is 'failed', writes nothing, and leaves the events pending", async () => {
    // It used to write the carried-forward digest and report "ran": the new
    // Digest row moved the pending watermark past events nobody had read.
    const dataDir = mkdtempSync(join(tmpdir(), "sc-mcp-digestnow-badjson-"));
    let calls = 0;
    const llm: DigestChatModel = {
      chat: async () => {
        calls += 1;
        return "I am not JSON";
      }
    };
    const backend = createEmbeddedBackend({ dataDir, scopeName: "/tmp/digest-now-badjson", env: {} as NodeJS.ProcessEnv, digestLlm: llm, backgroundDigest: false });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      await backend.init();
      // A prior digest exists (the first note's placeholder), so stage 2
      // degrades to a carry-forward rather than throwing outright.
      await backend.remember({ text: "an explicit note" });
      await backend.remember({ text: "we decided to ship on Tuesday", consolidate: true });
      const store = await openStore(dataDir);
      const digestsBefore = countRows(store.db, "Digest");
      await store.close();

      const result = await backend.digestNow();

      expect(result).toEqual({ ran: false, reason: "failed" });
      expect(calls).toBeGreaterThan(0);
      const after = await openStore(dataDir);
      try {
        expect(countRows(after.db, "Digest")).toBe(digestsBefore);
      } finally {
        await after.close();
      }
      expect((await backend.pendingEvents!())!.events).toBe(1);
      expect(errorSpy).toHaveBeenCalledWith("[statecore-mcp] digest run failed", expect.any(Error));
    } finally {
      errorSpy.mockRestore();
      await backend.close();
      rmSync(dataDir, { recursive: true, force: true });
    }
  });

  it("embedded: a run whose selection budget left pending events out reports {ran: true, partial: true}", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "sc-mcp-digestnow-partial-"));
    const { llm } = makeStubLlm();
    const backend = createEmbeddedBackend({ dataDir, scopeName: "/tmp/digest-now-partial", env: {} as NodeJS.ProcessEnv, digestLlm: llm, backgroundDigest: false });
    try {
      await backend.init();
      // 45 distinct events against a 40-event selection budget.
      const words = ["amber", "basil", "cedar", "delta", "ember", "fjord", "gable", "heron", "indigo"];
      for (let i = 0; i < 45; i++) {
        await backend.remember({ text: `${words[i % 9]} ${words[(i * 4) % 9]} topic number ${i} with ${"x".repeat(i)}`, consolidate: true });
      }

      expect(await backend.digestNow()).toEqual({ ran: true, partial: true });
    } finally {
      await backend.close();
      rmSync(dataDir, { recursive: true, force: true });
    }
  });

  it("http backend: {ran: false, reason: 'unsupported'} without touching the network", async () => {
    // Port 9 (discard) would fail loudly if digestNow ever issued a request.
    const backend = createHttpBackend({ baseUrl: "http://127.0.0.1:9", userId: "local", scopeName: "digest-now-http" });
    const result = await backend.digestNow();
    expect(result).toEqual({ ran: false, reason: "unsupported" });
  });
});
