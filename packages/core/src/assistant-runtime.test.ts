import { describe, expect, it, vi } from "vitest";
import {
  AssistantSession,
  createRuntimeRecallPolicy,
  DefaultMemoryWritePolicy,
  DefaultRecallPolicy,
  ProfiledDigestPolicy,
  ProfiledMemoryWritePolicy,
  ThresholdDigestPolicy,
  type RuntimeMemoryService,
  type RuntimeRetrieveService
} from "./assistant-runtime";

describe("DefaultMemoryWritePolicy", () => {
  const policy = new DefaultMemoryWritePolicy();

  it("classifies acknowledgements as ephemeral", () => {
    expect(policy.classifyTurn({ message: "thanks" })).toEqual({
      tier: "ephemeral",
      reason: "acknowledgement_only"
    });
  });

  it("classifies explicit structured facts as stable", () => {
    expect(policy.classifyTurn({ message: "constraint: keep api stable" })).toEqual({
      tier: "stable",
      reason: "explicit_structured_memory"
    });
  });

  it("classifies spec-like messages as documented", () => {
    expect(policy.classifyTurn({ message: "Architecture spec update for retrieval ranking" })).toEqual({
      tier: "documented",
      reason: "document_like_update"
    });
  });
});

describe("Profiled policies", () => {
  it("uses conservative profile to demote stable signals", () => {
    const policy = new ProfiledMemoryWritePolicy("conservative");
    expect(policy.classifyTurn({ message: "We decide to change the release plan" })).toEqual({
      tier: "candidate",
      reason: "profile_conservative_requires_explicit_promotion"
    });
  });

  it("uses document-heavy profile to promote long-form updates", () => {
    const policy = new ProfiledMemoryWritePolicy("document-heavy");
    expect(
      policy.classifyTurn({ message: "Architecture update\nThis is a long form spec-like note for runtime integration." })
    ).toEqual({
      tier: "documented",
      reason: "profile_document_heavy_long_form_memory"
    });
  });

  it("uses conservative digest policy to require documented turns", async () => {
    const policy = new ProfiledDigestPolicy("conservative");
    await expect(policy.shouldDigest({ writeTier: "stable", turn: { message: "stable" } } as any)).resolves.toEqual({
      shouldDigest: false,
      reason: "profile_conservative_skip_non_documented"
    });
  });

  it("allows long-form promotion override", () => {
    const policy = new ProfiledMemoryWritePolicy("conservative");
    expect(
      policy.classifyTurn({
        message: "This is a long runtime update\nwith multiple lines\nthat should be documented.",
        policyOverrides: { promoteLongFormToDocumented: true }
      })
    ).toEqual({
      tier: "documented",
      reason: "override_promote_long_form"
    });
  });

  it("allows candidate digest override", async () => {
    const policy = new ProfiledDigestPolicy("default");
    await expect(
      policy.shouldDigest({
        writeTier: "candidate",
        turn: { message: "candidate", policyOverrides: { digestOnCandidate: true } }
      } as any)
    ).resolves.toEqual({
      shouldDigest: true,
      reason: "override_digest_on_candidate"
    });
  });

  it("derives recall limit from profile and override", async () => {
    const retrieve = vi.fn(async () => ({ digest: null, events: [] }));
    const conservativeRecall = createRuntimeRecallPolicy(
      { retrieve } as unknown as RuntimeRetrieveService,
      { profile: "conservative" }
    );
    await conservativeRecall.resolve({ scopeId: "scope-1", message: "test" });
    expect(retrieve).toHaveBeenCalledWith("scope-1", 8, "test");

    const overrideRecall = createRuntimeRecallPolicy(
      { retrieve } as unknown as RuntimeRetrieveService,
      { profile: "conservative", overrides: { recallLimit: 21 } }
    );
    await overrideRecall.resolve({ scopeId: "scope-1", message: "override" });
    expect(retrieve).toHaveBeenCalledWith("scope-1", 21, "override");
  });
});

describe("AssistantSession", () => {
  function buildServices() {
    const ingestEvent = vi.fn(async () => ({ ok: true }));
    const retrieve = vi.fn(async () => ({
      digest: {
        id: "digest-1",
        scopeId: "scope-1",
        summary: "goal: keep api stable",
        changes: "- We decide to prioritize digest consistency",
        nextSteps: ["Document replay checks"],
        createdAt: new Date("2026-03-17T00:00:00.000Z")
      },
      events: [
        { id: "evt-1", content: "We decide to prioritize digest consistency", createdAt: new Date("2026-03-17T00:00:00.000Z") }
      ],
      retrieval: {
        matches: [
          {
            id: "evt-1",
            sourceType: "stream",
            rankingReason: "embedding_rerank, concepts=decision, terms=prioritize|digest|consistency",
            heuristicScore: 0.75,
            recencyScore: 1,
            embeddingScore: 0.91,
            finalScore: 0.876
          }
        ]
      }
    }));

    return {
      memoryService: { ingestEvent } satisfies RuntimeMemoryService,
      retrieveService: { retrieve } satisfies RuntimeRetrieveService,
      ingestEvent,
      retrieve
    };
  }

  it("writes stable turns, returns evidence, and triggers digest", async () => {
    const { memoryService, retrieveService, ingestEvent } = buildServices();
    const requestDigest = vi.fn(async () => undefined);
    const llm = {
      chat: vi.fn(async () => "Grounded answer")
    };

    const session = new AssistantSession({
      userId: "user-1",
      scopeId: "scope-1",
      memoryService,
      recallPolicy: new DefaultRecallPolicy(retrieveService, {
        scopeStateLoader: async () => ({
          digestId: "digest-1",
          state: {
            stableFacts: {
              goal: "keep api stable",
              constraints: ["self-hosted first"]
            },
            todos: ["Document replay checks"],
            provenance: {
              goal: [{ id: "doc:goal", sourceType: "document", key: "doc:goal" }],
              todos: [{ value: "Document replay checks", refs: [{ id: "e1", sourceType: "event", kind: "decision" }] }]
            },
            recentChanges: [
              { field: "goal", action: "set", value: "keep api stable" },
              { field: "todos", action: "add", value: "Document replay checks" }
            ]
          }
        })
      }),
      llm: llm as any,
      prompts: {
        system: "Use memory.",
        user: "Question: {{question}}\nDigest: {{digest}}\nEvents:\n{{events}}"
      },
      digestPolicy: new ThresholdDigestPolicy(),
      digestTrigger: { requestDigest }
    });

    const result = await session.handleTurn({
      message: "We decide to keep replay consistency in scope",
      source: "sdk"
    });

    expect(result.answer).toBe("Grounded answer");
    expect(result.writeTier).toBe("stable");
    expect(result.digestTriggered).toBe(true);
    expect(result.notes).toContain("write_tier:stable_fact_signal");
    expect(result.notes).toContain("digest:stable_or_documented_turn");
    expect(result.evidence.digestIds).toEqual(["digest-1"]);
    expect(result.evidence.eventIds).toEqual(["evt-1"]);
    expect(result.evidence.stateRefs).toEqual(["digest-1"]);
    expect(result.evidence.digestSummary).toBe("goal: keep api stable");
    expect(result.evidence.eventSnippets?.[0]?.snippet).toContain("prioritize digest consistency");
    expect(result.evidence.eventSnippets?.[0]).toMatchObject({
      sourceType: "stream",
      rankingReason: "embedding_rerank, concepts=decision, terms=prioritize|digest|consistency",
      heuristicScore: 0.75,
      recencyScore: 1,
      embeddingScore: 0.91,
      finalScore: 0.876
    });
    expect(result.evidence.stateDetails).toEqual({
      digestId: "digest-1",
      goal: "keep api stable",
      constraints: ["self-hosted first"],
      todos: ["Document replay checks"],
      risks: [],
      provenanceFields: ["goal", "todos"],
      transitionTaxonomy: {
        "goal:set": 1,
        "todos:add": 1
      },
      recentChanges: [
        { field: "goal", action: "set", value: "keep api stable" },
        { field: "todos", action: "add", value: "Document replay checks" }
      ]
    });
    expect(result.evidence.stateSummary).toBe(
      "digest:digest-1; goal:keep api stable; constraints:self-hosted first; todos:Document replay checks; provenance:goal|todos; recent:goal:set:keep api stable | todos:add:Document replay checks"
    );
    expect(ingestEvent).toHaveBeenCalledTimes(2);
    expect(requestDigest).toHaveBeenCalledWith("scope-1");
  });

  it("skips memory writes for ephemeral turns", async () => {
    const { memoryService, retrieveService, ingestEvent } = buildServices();
    const session = new AssistantSession({
      userId: "user-1",
      scopeId: "scope-1",
      memoryService,
      recallPolicy: new DefaultRecallPolicy(retrieveService),
      llm: { chat: vi.fn(async () => "Acknowledged") } as any,
      prompts: {
        system: "Use memory.",
        user: "Question: {{question}}\nDigest: {{digest}}\nEvents:\n{{events}}"
      }
    });

    const result = await session.handleTurn({
      message: "thanks",
      source: "sdk"
    });

    expect(result.writeTier).toBe("ephemeral");
    expect(result.digestTriggered).toBe(false);
    expect(result.notes).toContain("write_tier:acknowledgement_only");
    expect(ingestEvent).not.toHaveBeenCalled();
  });

  it("respects explicit write tier and forced digest mode", async () => {
    const { memoryService, retrieveService, ingestEvent } = buildServices();
    const requestDigest = vi.fn(async () => undefined);
    const session = new AssistantSession({
      userId: "user-1",
      scopeId: "scope-1",
      memoryService,
      recallPolicy: new DefaultRecallPolicy(retrieveService),
      llm: { chat: vi.fn(async () => "Stored") } as any,
      prompts: {
        system: "Use memory.",
        user: "Question: {{question}}\nDigest: {{digest}}\nEvents:\n{{events}}"
      },
      digestPolicy: new ThresholdDigestPolicy(99),
      digestTrigger: { requestDigest }
    });

    const result = await session.handleTurn({
      message: "Temporary spec note",
      source: "sdk",
      writeTier: "documented",
      documentKey: "doc:runtime-test",
      digestMode: "force"
    });

    expect(result.writeTier).toBe("documented");
    expect(result.digestTriggered).toBe(true);
    expect(result.notes).toContain("write_tier:explicit_write_tier");
    expect(result.notes).toContain("digest:forced_by_input");
    expect(requestDigest).toHaveBeenCalledWith("scope-1");
    expect(ingestEvent).toHaveBeenNthCalledWith(1, expect.objectContaining({
      type: "document",
      key: "doc:runtime-test"
    }));
  });

  it("records skipped digest mode in notes", async () => {
    const { memoryService, retrieveService } = buildServices();
    const requestDigest = vi.fn(async () => undefined);
    const session = new AssistantSession({
      userId: "user-1",
      scopeId: "scope-1",
      memoryService,
      recallPolicy: new DefaultRecallPolicy(retrieveService),
      llm: { chat: vi.fn(async () => "Stored") } as any,
      prompts: {
        system: "Use memory.",
        user: "Question: {{question}}\nDigest: {{digest}}\nEvents:\n{{events}}"
      },
      digestPolicy: new ThresholdDigestPolicy(),
      digestTrigger: { requestDigest }
    });

    const result = await session.handleTurn({
      message: "TODO: measure drift",
      source: "sdk",
      digestMode: "skip"
    });

    expect(result.digestTriggered).toBe(false);
    expect(result.notes).toContain("digest:skipped_by_input");
    expect(requestDigest).not.toHaveBeenCalled();
  });
});
