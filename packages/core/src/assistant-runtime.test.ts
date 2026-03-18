import { describe, expect, it, vi } from "vitest";
import {
  AssistantSession,
  DefaultMemoryWritePolicy,
  DefaultRecallPolicy,
  ThresholdDigestPolicy,
  type RuntimeMemoryService,
  type RuntimeRetrieveService
} from "./assistant-runtime";

describe("DefaultMemoryWritePolicy", () => {
  const policy = new DefaultMemoryWritePolicy();

  it("classifies acknowledgements as ephemeral", () => {
    expect(policy.classifyTurn({ message: "thanks" })).toBe("ephemeral");
  });

  it("classifies explicit structured facts as stable", () => {
    expect(policy.classifyTurn({ message: "constraint: keep api stable" })).toBe("stable");
  });

  it("classifies spec-like messages as documented", () => {
    expect(policy.classifyTurn({ message: "Architecture spec update for retrieval ranking" })).toBe("documented");
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
      ]
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
        scopeStateLoader: async () => ({ digestId: "digest-1" })
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
    expect(result.evidence.digestIds).toEqual(["digest-1"]);
    expect(result.evidence.eventIds).toEqual(["evt-1"]);
    expect(result.evidence.stateRefs).toEqual(["digest-1"]);
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
    expect(requestDigest).toHaveBeenCalledWith("scope-1");
    expect(ingestEvent).toHaveBeenNthCalledWith(1, expect.objectContaining({
      type: "document",
      key: "doc:runtime-test"
    }));
  });
});
