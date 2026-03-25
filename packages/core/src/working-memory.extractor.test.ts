import { describe, expect, it } from "vitest";
import { extractWorkingMemoryState } from "./working-memory.extractor";

describe("extractWorkingMemoryState", () => {
  it("extracts lightweight working memory from recent events", () => {
    const state = extractWorkingMemoryState([
      {
        id: "evt-1",
        type: "document",
        key: "doc:goal",
        content: "goal: ship a three-layer memory runtime",
        createdAt: new Date("2026-03-24T00:00:00.000Z")
      },
      {
        id: "evt-2",
        type: "stream",
        content: "Constraint reminder: keep api stable",
        createdAt: new Date("2026-03-24T00:01:00.000Z")
      },
      {
        id: "evt-3",
        type: "stream",
        content: "We decide to update working memory before stable state digest",
        createdAt: new Date("2026-03-24T00:02:00.000Z")
      },
      {
        id: "evt-4",
        type: "stream",
        content: "Status update: fast path now returns before background digest",
        createdAt: new Date("2026-03-24T00:03:00.000Z")
      }
    ]);

    expect(state.currentGoal).toBe("ship a three-layer memory runtime");
    expect(state.activeConstraints).toContain("keep api stable");
    expect(state.recentDecisions[0]).toContain("working memory");
    expect(state.progressSummary).toContain("fast path now returns");
    expect(state.sourceEventIds).toHaveLength(4);
  });

  it("ignores assistant reply noise and parses escaped multiline structured turns", () => {
    const state = extractWorkingMemoryState([
      {
        id: "evt-1",
        type: "stream",
        role: "user",
        content: "goal: ship a three-layer runtime\\nconstraint: keep responses quick\\nWe decide to update working memory in the background\\nTODO: inspect fast view",
        createdAt: new Date("2026-03-24T01:00:00.000Z")
      },
      {
        id: "evt-2",
        type: "stream",
        role: "assistant",
        content: "Assistant reply: Would you like me to draft concrete test cases for your exact CLI tool?",
        createdAt: new Date("2026-03-24T01:01:00.000Z")
      }
    ]);

    expect(state.currentGoal).toBe("ship a three-layer runtime");
    expect(state.activeConstraints).toEqual(["keep responses quick"]);
    expect(state.recentDecisions).toEqual(["We decide to update working memory in the background"]);
    expect(state.openQuestions).toEqual([]);
    expect(state.sourceEventIds).toEqual(["evt-1"]);
  });
});
