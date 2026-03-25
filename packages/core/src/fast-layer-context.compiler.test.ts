import { describe, expect, it } from "vitest";
import { compileFastLayerContext } from "./fast-layer-context.compiler";

describe("compileFastLayerContext", () => {
  it("builds compact prompt blocks from working memory, stable state, retrieval, and recent turns", () => {
    const context = compileFastLayerContext({
      message: "What is the current goal?",
      workingMemoryView: {
        goal: "ship fast + stable layered memory",
        constraints: ["keep api stable"],
        decisions: ["Working memory updates more frequently than stable state"],
        progressSummary: "runtime path refactor in progress",
        openQuestions: ["Should retrieval use working memory hints?"],
        taskFrame: "runtime refactor"
      },
      stateLayerView: {
        goal: "ship replayable state layer",
        constraints: ["self-hosted first"],
        decisions: ["Stable state remains authoritative"],
        todos: ["document layered architecture"],
        openQuestions: [],
        risks: []
      },
      retrievalSnippets: [
        {
          id: "evt-1",
          content: "We decide to keep stable state authoritative",
          createdAt: new Date("2026-03-24T00:00:00.000Z")
        }
      ],
      recentTurns: [
        {
          id: "turn-1",
          role: "user",
          content: "Can this return faster?",
          createdAt: new Date("2026-03-24T00:01:00.000Z")
        }
      ]
    });

    expect(context.workingMemoryBlock).toContain("Current goal");
    expect(context.stableStateBlock).toContain("Stable goal");
    expect(context.retrievalBlock).toContain("keep stable state authoritative");
    expect(context.recentTurnsBlock).toContain("Can this return faster?");
    expect(context.retrievalHints.priorityTerms.length).toBeGreaterThan(0);
    expect(context.summary).toContain("working_goal");
  });

  it("filters assistant-heavy retrieval noise and truncates oversized prompt blocks", () => {
    const context = compileFastLayerContext({
      message: "What changed?",
      workingMemoryView: {
        constraints: [],
        decisions: [],
        openQuestions: []
      },
      stateLayerView: {
        constraints: [],
        decisions: [],
        todos: [],
        openQuestions: [],
        risks: []
      },
      retrievalSnippets: [
        {
          id: "assistant-1",
          content: `Assistant reply: ${"very long ".repeat(80)}`,
          createdAt: new Date("2026-03-24T00:00:00.000Z")
        },
        {
          id: "user-1",
          content: `goal: keep the fast layer compact ${"fact ".repeat(60)}`,
          createdAt: new Date("2026-03-24T00:01:00.000Z")
        }
      ],
      recentTurns: [
        {
          id: "turn-1",
          role: "assistant",
          content: "A".repeat(800),
          createdAt: new Date("2026-03-24T00:02:00.000Z")
        }
      ]
    });

    expect(context.retrievalBlock).toContain("goal: keep the fast layer compact");
    expect(context.retrievalBlock).not.toContain("Assistant reply:");
    expect(context.retrievalBlock.length).toBeLessThan(400);
    expect(context.recentTurnsBlock.length).toBeLessThan(420);
  });
});
