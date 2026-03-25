import { describe, expect, it, vi } from "vitest";
import {
  AssistantSession,
  createRuntimeRecallPolicy,
  DefaultMemoryWritePolicy,
  DefaultRecallPolicy,
  ProfiledDigestPolicy,
  ProfiledMemoryWritePolicy,
  ThresholdDigestPolicy,
  type RuntimeBackgroundProcessor,
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
    expect(retrieve).toHaveBeenCalledWith("scope-1", 2, "test");

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
    const { memoryService, retrieveService } = buildServices();
    const persistTurnArtifacts = vi.fn(async () => undefined);
    const requestWorkingMemoryUpdate = vi.fn(async () => undefined);
    const requestStableStateDigest = vi.fn(async () => undefined);
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
        }),
        workingMemoryLoader: async () => ({
          scopeId: "scope-1",
          version: 4,
          state: {
            currentGoal: "keep api stable",
            activeConstraints: ["self-hosted first"],
            recentDecisions: ["We decide to prioritize digest consistency"],
            progressSummary: "runtime integration underway",
            openQuestions: [],
            sourceEventIds: ["evt-1"]
          },
          updatedAt: new Date("2026-03-17T00:00:00.000Z")
        }),
        recentTurnsLoader: async () => [
          { id: "turn-1", content: "Previous user turn", createdAt: new Date("2026-03-17T00:00:00.000Z") }
        ]
      }),
      llm: llm as any,
      prompts: {
        system: "Use memory.",
        user: "Question: {{question}}\nWorking:\n{{workingMemory}}\nStable:\n{{stableState}}\nDigest: {{digest}}\nRetrieved:\n{{retrieval}}\nRecent:\n{{recentTurns}}\nEvents:\n{{events}}"
      },
      digestPolicy: new ThresholdDigestPolicy(),
      backgroundProcessor: {
        persistTurnArtifacts,
        requestWorkingMemoryUpdate,
        requestStableStateDigest
      } satisfies RuntimeBackgroundProcessor
    });

    const result = await session.handleTurn({
      message: "We decide to keep replay consistency in scope",
      source: "sdk"
    });

    expect(result.answer).toBe("Grounded answer");
    expect(result.writeTier).toBe("stable");
    expect(result.digestTriggered).toBe(true);
    expect(result.workingMemoryVersion).toBe(4);
    expect(result.stableStateVersion).toBe("digest-1");
    expect(result.usedFastLayerContextSummary).toContain("working_goal:keep api stable");
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
      confidence: {
        goal: 1,
        constraints: [],
        decisions: [],
        todos: [{ value: "Document replay checks", score: 0.7 }]
      },
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
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(persistTurnArtifacts).toHaveBeenCalledWith(expect.objectContaining({
      scopeId: "scope-1",
      writeTier: "stable",
      answer: "Grounded answer"
    }));
    expect(requestWorkingMemoryUpdate).toHaveBeenCalledWith("scope-1");
    expect(requestStableStateDigest).toHaveBeenCalledWith("scope-1");
  });

  it("skips memory writes for ephemeral turns", async () => {
    const { memoryService, retrieveService } = buildServices();
    const persistTurnArtifacts = vi.fn(async () => undefined);
    const session = new AssistantSession({
      userId: "user-1",
      scopeId: "scope-1",
      memoryService,
      recallPolicy: new DefaultRecallPolicy(retrieveService),
      llm: { chat: vi.fn(async () => "Acknowledged") } as any,
      prompts: {
        system: "Use memory.",
        user: "Question: {{question}}\nDigest: {{digest}}\nEvents:\n{{events}}"
      },
      backgroundProcessor: {
        persistTurnArtifacts
      } as RuntimeBackgroundProcessor
    });

    const result = await session.handleTurn({
      message: "thanks",
      source: "sdk"
    });

    expect(result.writeTier).toBe("ephemeral");
    expect(result.digestTriggered).toBe(false);
    expect(result.notes).toContain("write_tier:acknowledgement_only");
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(persistTurnArtifacts).not.toHaveBeenCalled();
  });

  it("returns explicit null layer metadata when no working or stable snapshot exists yet", async () => {
    const { memoryService, retrieveService } = buildServices();
    const session = new AssistantSession({
      userId: "user-1",
      scopeId: "scope-1",
      memoryService,
      recallPolicy: new DefaultRecallPolicy(retrieveService, {
        scopeStateLoader: async () => null,
        workingMemoryLoader: async () => null
      }),
      llm: { chat: vi.fn(async () => "Fresh response") } as any,
      prompts: {
        system: "Use memory.",
        user: "Question: {{question}}\nDigest: {{digest}}\nEvents:\n{{events}}"
      }
    });

    const result = await session.handleTurn({
      message: "goal: start a new scope",
      source: "sdk"
    });

    expect(result.workingMemoryVersion).toBeNull();
    expect(result.stableStateVersion).toBeNull();
    expect(typeof result.usedFastLayerContextSummary).toBe("string");
    expect(result.usedFastLayerContextSummary?.length).toBeGreaterThan(0);
  });

  it("respects explicit write tier and forced digest mode", async () => {
    const { memoryService, retrieveService } = buildServices();
    const persistTurnArtifacts = vi.fn(async () => undefined);
    const requestStableStateDigest = vi.fn(async () => undefined);
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
      backgroundProcessor: {
        persistTurnArtifacts,
        requestStableStateDigest
      } as RuntimeBackgroundProcessor
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
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(persistTurnArtifacts).toHaveBeenCalled();
    expect(requestStableStateDigest).toHaveBeenCalledWith("scope-1");
  });

  it("records skipped digest mode in notes", async () => {
    const { memoryService, retrieveService } = buildServices();
    const requestStableStateDigest = vi.fn(async () => undefined);
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
      backgroundProcessor: {
        requestStableStateDigest
      } as RuntimeBackgroundProcessor
    });

    const result = await session.handleTurn({
      message: "TODO: measure drift",
      source: "sdk",
      digestMode: "skip"
    });

    expect(result.digestTriggered).toBe(false);
    expect(result.notes).toContain("digest:skipped_by_input");
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(requestStableStateDigest).not.toHaveBeenCalled();
  });

  it("returns before slow background persistence completes", async () => {
    const { memoryService, retrieveService } = buildServices();
    let release = () => undefined;
    const persistTurnArtifacts = vi.fn(() => new Promise<void>((resolve) => {
      release = resolve;
    }));
    const session = new AssistantSession({
      userId: "user-1",
      scopeId: "scope-1",
      memoryService,
      recallPolicy: new DefaultRecallPolicy(retrieveService),
      llm: { chat: vi.fn(async () => "Fast reply") } as any,
      prompts: {
        system: "Use memory.",
        user: "Question: {{question}}\nDigest: {{digest}}\nEvents:\n{{events}}"
      },
      backgroundProcessor: {
        persistTurnArtifacts
      } as RuntimeBackgroundProcessor
    });

    const result = await session.handleTurn({
      message: "We decide to keep fast turns non-blocking",
      source: "sdk"
    });

    expect(result.answer).toBe("Fast reply");
    expect(persistTurnArtifacts).toHaveBeenCalledTimes(1);
    release();
  });

  it("supports runtime prompts that respond from the current turn when memory is sparse", async () => {
    const llm = {
      chat: vi.fn(async (messages: Array<{ role: string; content: string }>) => messages[1]?.content ?? "")
    };

    const session = new AssistantSession({
      userId: "user-1",
      scopeId: "scope-1",
      memoryService: { ingestEvent: vi.fn(async () => ({ ok: true })) },
      recallPolicy: {
        resolve: async () => ({
          digest: null,
          events: [],
          retrieval: { matches: [] },
          stateRef: null,
          stateSnapshot: null,
          workingMemorySnapshot: null,
          workingMemoryView: { constraints: [], decisions: [], openQuestions: [] },
          stableStateView: { constraints: [], decisions: [], todos: [], openQuestions: [], risks: [] },
          recentTurns: [],
          fastLayerContext: {
            systemContext: "Respond quickly using the current user turn plus any recalled context.",
            workingMemoryBlock: "(none)",
            stableStateBlock: "(none)",
            retrievalBlock: "(none)",
            recentTurnsBlock: "(none)",
            retrievalHints: { priorityTerms: [], exclusions: [] },
            summary: "message_only"
          }
        })
      },
      llm: llm as any,
      prompts: {
        system: "Fast runtime.",
        user: "Current user turn:\n{{currentTurn}}\nWorking:\n{{workingMemory}}\nStable:\n{{stableState}}"
      }
    });

    const result = await session.handleTurn({
      message: "Please turn this into a three-layer runtime with fast turns and background memory updates.",
      source: "sdk",
      writeTier: "candidate",
      digestMode: "skip"
    });

    expect(result.answer).toContain("Current user turn:");
    expect(result.answer).toContain("three-layer runtime");
    expect(result.answer).toContain("Working:\n(none)");
    expect(llm.chat).toHaveBeenCalledWith(expect.any(Array), {
      maxOutputTokens: 400,
      reasoningEffort: "low"
    });
  });

  it("falls back to uncapped runtime output when the capped call returns empty content", async () => {
    const chat = vi.fn()
      .mockRejectedValueOnce(new Error("LLM response missing content"))
      .mockResolvedValueOnce("Recovered fast reply");

    const session = new AssistantSession({
      userId: "user-1",
      scopeId: "scope-1",
      memoryService: { ingestEvent: vi.fn(async () => ({ ok: true })) },
      recallPolicy: {
        resolve: async () => ({
          digest: null,
          events: [],
          retrieval: { matches: [] },
          stateRef: null,
          stateSnapshot: null,
          workingMemorySnapshot: null,
          workingMemoryView: { constraints: [], decisions: [], openQuestions: [] },
          stableStateView: { constraints: [], decisions: [], todos: [], openQuestions: [], risks: [] },
          recentTurns: [],
          fastLayerContext: {
            systemContext: "Respond quickly.",
            workingMemoryBlock: "(none)",
            stableStateBlock: "(none)",
            retrievalBlock: "(none)",
            recentTurnsBlock: "(none)",
            retrievalHints: { priorityTerms: [], exclusions: [] },
            summary: "message_only"
          }
        })
      },
      llm: { chat } as any,
      prompts: {
        system: "Fast runtime.",
        user: "Current user turn:\n{{currentTurn}}"
      }
    });

    const result = await session.handleTurn({
      message: "goal: keep fast runtime answers stable",
      source: "sdk",
      digestMode: "skip"
    });

    expect(result.answer).toBe("Recovered fast reply");
    expect(chat).toHaveBeenNthCalledWith(1, expect.any(Array), {
      maxOutputTokens: 400,
      reasoningEffort: "low"
    });
    expect(chat).toHaveBeenNthCalledWith(2, expect.any(Array), {
      reasoningEffort: "low"
    });
  });
});
