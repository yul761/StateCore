import { describe, it, expect, vi } from "vitest";
import { computeFactKey, getDefaultFacetPack } from "@statecore/core";
import { createDigestWithSnapshot, type DigestWritePrisma, type DigestWriteTx } from "./digest-write";

function makePrismaStub(
  snapshotShouldReject = false,
  latestSnapshotState: unknown = null,
  forgottenKeys: string[] = []
): {
  prisma: DigestWritePrisma;
  calls: string[];
  digestCreateArgs: any[];
  snapshotCreateArgs: any[];
} {
  const calls: string[] = [];
  const digestCreateArgs: any[] = [];
  const snapshotCreateArgs: any[] = [];

  const prisma: DigestWritePrisma = {
    $transaction: async (fn) => {
      const tx: DigestWriteTx = {
        digest: {
          create: vi.fn(async (args) => {
            calls.push("digest.create");
            digestCreateArgs.push(args);
            return { id: "digest-uuid-1" };
          })
        },
        digestStateSnapshot: {
          create: vi.fn(async (args) => {
            calls.push("snapshot.create");
            snapshotCreateArgs.push(args);
            if (snapshotShouldReject) throw new Error("snapshot write failed");
            return {};
          }),
          findFirst: vi.fn(async () => {
            calls.push("snapshot.findFirst");
            return latestSnapshotState ? { state: latestSnapshotState } : null;
          })
        },
        forgottenFact: {
          findMany: vi.fn(async () => {
            calls.push("forgottenFact.findMany");
            return forgottenKeys.map((factKey) => ({ factKey }));
          })
        },
        $executeRaw: vi.fn(async (sql: TemplateStringsArray, ...values: unknown[]) => {
          calls.push(`lock:${sql.join("?")}:${values.join(",")}`);
          return 0;
        })
      };
      return fn(tx);
    }
  };

  return { prisma, calls, digestCreateArgs, snapshotCreateArgs };
}

describe("createDigestWithSnapshot", () => {
  it("calls digest.create before digestStateSnapshot.create inside $transaction (atomic)", async () => {
    const { prisma, calls } = makePrismaStub();

    await createDigestWithSnapshot(prisma, {
      scopeId: "scope-1",
      summary: "test summary",
      changes: "- change A\n- change B",
      nextSteps: ["step 1"],
      state: { profile: {} },
      consistency: { score: 1 }
    });

    expect(calls).toEqual([
      "lock:SELECT pg_advisory_xact_lock(hashtext(?)):scope-1",
      "snapshot.findFirst",
      "digest.create",
      "snapshot.create"
    ]);
  });

  it("takes the scope's advisory lock first and reads forgotten keys under it", async () => {
    const { prisma, calls } = makePrismaStub(false, { profile: {}, factRegistry: [] });

    await createDigestWithSnapshot(prisma, {
      scopeId: "scope-7",
      summary: "s",
      changes: "",
      nextSteps: [],
      state: { profile: {}, factRegistry: [] },
      consistency: null
    });

    expect(calls.slice(0, 3)).toEqual([
      "lock:SELECT pg_advisory_xact_lock(hashtext(?)):scope-7",
      "snapshot.findFirst",
      "forgottenFact.findMany"
    ]);
  });

  it("passes the created digest's id as digestId on the snapshot", async () => {
    const { prisma, snapshotCreateArgs } = makePrismaStub();

    await createDigestWithSnapshot(prisma, {
      scopeId: "scope-1",
      summary: "summary",
      changes: "- c",
      nextSteps: [],
      state: {},
      consistency: {}
    });

    expect(snapshotCreateArgs[0].data.digestId).toBe("digest-uuid-1");
  });

  it("includes rebuildGroupId in digest data when provided", async () => {
    const { prisma, digestCreateArgs } = makePrismaStub();

    await createDigestWithSnapshot(prisma, {
      scopeId: "scope-1",
      summary: "s",
      changes: "- c",
      nextSteps: [],
      state: {},
      consistency: {},
      rebuildGroupId: "rebuild-group-abc"
    });

    expect(digestCreateArgs[0].data.rebuildGroupId).toBe("rebuild-group-abc");
  });

  it("omits rebuildGroupId from digest data when not provided", async () => {
    const { prisma, digestCreateArgs } = makePrismaStub();

    await createDigestWithSnapshot(prisma, {
      scopeId: "scope-1",
      summary: "s",
      changes: "- c",
      nextSteps: [],
      state: {},
      consistency: {}
    });

    expect(digestCreateArgs[0].data).not.toHaveProperty("rebuildGroupId");
  });

  it("rejects and propagates error when digestStateSnapshot.create fails", async () => {
    const { prisma } = makePrismaStub(true);

    await expect(
      createDigestWithSnapshot(prisma, {
        scopeId: "scope-1",
        summary: "s",
        changes: "- c",
        nextSteps: [],
        state: {},
        consistency: {}
      })
    ).rejects.toThrow("snapshot write failed");
  });

  it("returns the created digest object", async () => {
    const { prisma } = makePrismaStub();

    const result = await createDigestWithSnapshot(prisma, {
      scopeId: "scope-1",
      summary: "s",
      changes: "- c",
      nextSteps: [],
      state: {},
      consistency: {}
    });

    expect(result).toEqual({ id: "digest-uuid-1" });
  });

  it("persists selectionLog so the run's discards stay queryable", async () => {
    const { prisma, digestCreateArgs } = makePrismaStub();
    const selectionLog = {
      rationale: ["selected_docs:2", "dedup_near:evt-9"],
      drops: [{ reason: "cap_evicted", detail: { facet: "notes", cap: 30 } }]
    };

    await createDigestWithSnapshot(prisma, {
      scopeId: "scope-1",
      summary: "s",
      changes: "- c",
      nextSteps: [],
      state: {},
      consistency: {},
      selectionLog
    });

    expect(digestCreateArgs[0].data.selectionLog).toEqual(selectionLog);
  });

  it("omits selectionLog when the caller supplies none, so old rows stay distinguishable from empty ones", async () => {
    const { prisma, digestCreateArgs } = makePrismaStub();

    await createDigestWithSnapshot(prisma, {
      scopeId: "scope-1",
      summary: "s",
      changes: "- c",
      nextSteps: [],
      state: {},
      consistency: {}
    });

    expect(digestCreateArgs[0].data).not.toHaveProperty("selectionLog");
  });
});

describe("createDigestWithSnapshot — concurrent-note carry-over", () => {
  const noteEntry = {
    id: "n-conc",
    content: "note written while the digest ran",
    type: "profile",
    confidence: 0.9,
    addedAt: "2026-08-29T12:00:00.000Z",
    evidenceId: "n-conc-ev",
    evidenceType: "event",
    facet: "notes"
  };

  it("carries a note added to the latest snapshot after the pipeline's read", async () => {
    const latestState = { profile: { notes: [noteEntry.content] }, factRegistry: [noteEntry] };
    const { prisma, snapshotCreateArgs } = makePrismaStub(false, latestState);

    await createDigestWithSnapshot(prisma, {
      scopeId: "scope-1",
      summary: "s",
      changes: "",
      nextSteps: [],
      state: { profile: {}, factRegistry: [] },
      consistency: null
    });

    const written = snapshotCreateArgs[0].data.state as any;
    expect(written.factRegistry.some((e: any) => e.id === "n-conc")).toBe(true);
    expect(written.profile.notes).toContain(noteEntry.content);
  });

  it("writes the pipeline state untouched when nothing was written concurrently", async () => {
    const { prisma, snapshotCreateArgs } = makePrismaStub(false, { profile: {}, factRegistry: [] });

    await createDigestWithSnapshot(prisma, {
      scopeId: "scope-1",
      summary: "s",
      changes: "",
      nextSteps: [],
      state: { profile: {}, factRegistry: [] },
      consistency: null
    });

    const written = snapshotCreateArgs[0].data.state as any;
    expect(written.factRegistry).toEqual([]);
  });

  it("does not carry a forgotten note back in, so a digest frees its slot", async () => {
    // The pipeline pruned the forgotten note, so its registry id is missing from
    // the pipeline state — without the keys it looks like a concurrent write.
    const forgottenKey = computeFactKey("Notes", noteEntry.content);
    const latestState = { profile: { notes: [noteEntry.content] }, factRegistry: [noteEntry] };
    const { prisma, snapshotCreateArgs } = makePrismaStub(false, latestState, [forgottenKey]);

    await createDigestWithSnapshot(prisma, {
      scopeId: "scope-1",
      summary: "s",
      changes: "",
      nextSteps: [],
      state: { profile: { notes: [] }, factRegistry: [] },
      consistency: null
    });

    const written = snapshotCreateArgs[0].data.state as any;
    expect(written.profile.notes).toEqual([]);
    expect(written.factRegistry).toEqual([]);
  });

  it("holds the carried notes to the pack's cap", async () => {
    const pack = { ...getDefaultFacetPack(), facets: getDefaultFacetPack().facets.map((f) => (f.name === "notes" ? { ...f, cap: 2 } : f)) };
    const callerNote = (i: number) => ({ ...noteEntry, id: `c${i}`, content: `caller note ${i}`, origin: "note" });
    const pipelineState = {
      profile: { notes: ["caller note 0", "digest note"] },
      factRegistry: [callerNote(0), { ...noteEntry, id: "d0", content: "digest note", confidence: 0.6 }]
    };
    const latestState = { profile: { notes: ["caller note 0", "caller note 1"] }, factRegistry: [callerNote(0), callerNote(1)] };
    const { prisma, snapshotCreateArgs } = makePrismaStub(false, latestState);

    await createDigestWithSnapshot(prisma, {
      scopeId: "scope-1",
      summary: "s",
      changes: "",
      nextSteps: [],
      state: pipelineState,
      consistency: null,
      pack
    });

    const written = snapshotCreateArgs[0].data.state as any;
    expect(written.profile.notes).toEqual(["caller note 0", "caller note 1"]);
    expect(written.factRegistry.find((e: any) => e.id === "d0").retiredReason).toBe("cap_evicted");
  });
});
