import { describe, expect, it } from "vitest";
import { extractWorkingMemoryState, mergeWorkingMemoryState, selectWorkingMemoryEvents } from "./working-memory.extractor";

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

  it("preserves the latest explicit goal even when assistant replies crowd the recent event window", () => {
    const selected = selectWorkingMemoryEvents([
      {
        id: "evt-1",
        type: "stream",
        role: "user",
        content: "goal: ship a three-layer runtime",
        createdAt: new Date("2026-03-24T02:00:00.000Z")
      },
      {
        id: "evt-2",
        type: "stream",
        role: "user",
        content: "constraint: keep responses quick",
        createdAt: new Date("2026-03-24T02:01:00.000Z")
      },
      {
        id: "evt-3",
        type: "stream",
        role: "assistant",
        content: "Assistant reply: acknowledged",
        createdAt: new Date("2026-03-24T02:02:00.000Z")
      },
      {
        id: "evt-4",
        type: "stream",
        role: "user",
        content: "status: runtime smoke verifies layer metadata",
        createdAt: new Date("2026-03-24T02:03:00.000Z")
      }
    ], 2);

    expect(selected.map((event) => event.id)).toEqual(["evt-1", "evt-2", "evt-4"]);

    const state = extractWorkingMemoryState(selected);
    expect(state.currentGoal).toBe("ship a three-layer runtime");
  });

  it("extracts goal, preference, and question from natural language conversation turns", () => {
    const state = extractWorkingMemoryState([
      {
        id: "evt-1",
        type: "stream",
        role: "user",
        content: "I am trying to lose weight, do you know some good way?",
        createdAt: new Date("2026-03-24T03:00:00.000Z")
      },
      {
        id: "evt-2",
        type: "stream",
        role: "user",
        content: "I prefer something sustainable with diet and exercise.",
        createdAt: new Date("2026-03-24T03:01:00.000Z")
      },
      {
        id: "evt-3",
        type: "stream",
        role: "user",
        content: "I weigh 106 kg now, and I am 32, is that going to be a little difficult because of age?",
        createdAt: new Date("2026-03-24T03:02:00.000Z")
      }
    ]);

    expect(state.currentGoal).toBe("lose weight");
    expect(state.activeConstraints).toEqual(["sustainable with diet and exercise"]);
    expect(state.openQuestions).toEqual([
      "do you know some good way?",
      "is that going to be a little difficult because of age?"
    ]);
    expect(state.taskFrame).toBe("lose weight");
  });

  it("extracts natural-language goal constraints and background facts from conversational turns", () => {
    const state = extractWorkingMemoryState([
      {
        id: "evt-1",
        type: "stream",
        role: "user",
        content: "How can I lose weight without crash dieting?",
        createdAt: new Date("2026-03-24T03:10:00.000Z")
      },
      {
        id: "evt-2",
        type: "stream",
        role: "user",
        content: "I weigh 106 kg right now, and I'm 32.",
        createdAt: new Date("2026-03-24T03:11:00.000Z")
      },
      {
        id: "evt-3",
        type: "stream",
        role: "user",
        content: "I don't want anything too aggressive. I have mild knee pain.",
        createdAt: new Date("2026-03-24T03:12:00.000Z")
      }
    ]);

    expect(state.currentGoal).toBe("lose weight");
    expect(state.activeConstraints).toEqual([
      "avoid crash dieting",
      "avoid aggressive"
    ]);
    expect(state.openQuestions).toEqual(["How can I lose weight without crash dieting?"]);
    expect(state.progressSummary).toContain("I weigh 106 kg right now");
    expect(state.progressSummary).toContain("I'm 32");
    expect(state.progressSummary).toContain("I have mild knee pain");
  });

  it("extracts goal from 'I am looking to' phrasing", () => {
    const state = extractWorkingMemoryState([
      {
        id: "evt-1",
        type: "stream",
        role: "user",
        content: "I am looking to get fit, maybe squat to 200kg.",
        createdAt: new Date("2026-03-24T03:20:00.000Z")
      }
    ]);

    expect(state.currentGoal).toBe("get fit");
    expect(state.taskFrame).toBe("get fit");
  });

  it("merges refinement patches without discarding reliable heuristic fields", () => {
    const merged = mergeWorkingMemoryState(
      {
        currentGoal: "lose weight",
        activeConstraints: ["sustainable with diet and exercise"],
        recentDecisions: [],
        progressSummary: undefined,
        openQuestions: ["is age 32 a major obstacle?"],
        taskFrame: "lose weight",
        sourceEventIds: ["evt-1", "evt-2", "evt-3"]
      },
      {
        currentGoal: "lose weight safely and steadily",
        activeConstraints: ["avoid extreme diets"],
        openQuestions: ["what is a realistic weekly target?"],
        taskFrame: "healthy weight loss"
      },
      { maxItemsPerField: 5 }
    );

    expect(merged.currentGoal).toBe("lose weight safely and steadily");
    expect(merged.activeConstraints).toEqual([
      "sustainable with diet and exercise",
      "avoid extreme diets"
    ]);
    expect(merged.openQuestions).toEqual([
      "is age 32 a major obstacle?",
      "what is a realistic weekly target?"
    ]);
    expect(merged.taskFrame).toBe("healthy weight loss");
  });
});
