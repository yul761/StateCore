import { describe, expect, it } from "vitest";
import {
  consistencyCheck,
  detectDeltas,
  generateDigestStage2,
  normalizeDigestState,
  protectedStateMerge,
  selectEventsForDigest,
  type DigestState,
  type SelectedEvent
} from "./digest-control";
import type { MemoryEvent } from "./index";

function event(partial: Partial<MemoryEvent> & Pick<MemoryEvent, "id" | "scopeId" | "userId" | "content" | "type">): MemoryEvent {
  return {
    source: "api",
    createdAt: new Date(),
    ...partial
  };
}

describe("selectEventsForDigest", () => {
  it("dedups near-identical stream events and includes latest docs within budget", () => {
    const events: MemoryEvent[] = [
      event({ id: "s1", scopeId: "sc", userId: "u", type: "stream", content: "We decide to ship API v1", createdAt: new Date("2026-02-01T10:00:00Z") }),
      event({ id: "s2", scopeId: "sc", userId: "u", type: "stream", content: "We decide to ship API v1!", createdAt: new Date("2026-02-01T09:59:00Z") }),
      event({ id: "d1", scopeId: "sc", userId: "u", type: "document", key: "note:plan", content: "goal: launch beta", createdAt: new Date("2026-02-01T09:58:00Z") }),
      event({ id: "d2", scopeId: "sc", userId: "u", type: "document", key: "note:plan", content: "goal: launch beta soon", createdAt: new Date("2026-02-01T10:01:00Z") })
    ];

    const result = selectEventsForDigest({
      recentEvents: events,
      lastDigest: null,
      eventBudgetTotal: 3,
      eventBudgetDocs: 1,
      eventBudgetStream: 2
    });

    const ids = result.selectedEvents.map((item) => item.event.id);
    expect(ids).toContain("d2");
    expect(ids).not.toContain("d1");
    expect(ids).toContain("s1");
    expect(ids).not.toContain("s2");
  });
});

describe("detectDeltas", () => {
  it("keeps decisions even when novelty is low", () => {
    const selected: SelectedEvent[] = [
      {
        event: event({ id: "e1", scopeId: "sc", userId: "u", type: "stream", content: "we decide to keep postgres" }),
        features: { kind: "decision", importanceScore: 0.9, noveltyScore: 0 }
      },
      {
        event: event({ id: "e2", scopeId: "sc", userId: "u", type: "stream", content: "daily status update" }),
        features: { kind: "status", importanceScore: 0.4, noveltyScore: 0 }
      }
    ];

    const deltas = detectDeltas({
      lastDigestText: "we decide to keep postgres; daily status update",
      selectedEvents: selected,
      noveltyThreshold: 0.5
    });

    expect(deltas.map((item) => item.eventId)).toContain("e1");
  });
});

describe("protectedStateMerge", () => {
  it("does not overwrite goal without explicit goal marker", () => {
    const prevState: DigestState = {
      stableFacts: { goal: "ship alpha", constraints: ["no paid infra"], decisions: ["use postgres"] },
      workingNotes: {},
      todos: [],
      volatileContext: [],
      evidenceRefs: []
    };

    const merged = protectedStateMerge({
      prevState,
      documents: [event({ id: "doc1", scopeId: "sc", userId: "u", type: "document", key: "note:1", content: "regular update text" })],
      deltaCandidates: []
    });

    expect(merged.stableFacts.goal).toBe("ship alpha");
    expect(merged.stableFacts.decisions).toContain("use postgres");
  });

  it("captures volatile context and evidence references", () => {
    const merged = protectedStateMerge({
      prevState: null,
      documents: [
        event({ id: "doc1", scopeId: "sc", userId: "u", type: "document", key: "doc:goal", content: "goal: ship alpha" })
      ],
      deltaCandidates: [
        {
          eventId: "e1",
          reason: "novel_event",
          features: { kind: "status", importanceScore: 0.5, noveltyScore: 0.7 },
          event: event({ id: "e1", scopeId: "sc", userId: "u", type: "stream", content: "Status update: queue is stable" })
        },
        {
          eventId: "e2",
          reason: "novel_event",
          features: { kind: "note", importanceScore: 0.4, noveltyScore: 0.8 },
          event: event({ id: "e2", scopeId: "sc", userId: "u", type: "stream", content: "Note: keep digest reports small" })
        }
      ]
    });

    expect(merged.volatileContext).toContain("Status update: queue is stable");
    expect(merged.volatileContext).toContain("Note: keep digest reports small");
    expect(merged.evidenceRefs).toContainEqual(expect.objectContaining({
      id: "doc1",
      sourceType: "document",
      key: "doc:goal"
    }));
    expect(merged.evidenceRefs).toContainEqual(expect.objectContaining({
      id: "e1",
      sourceType: "event",
      kind: "status"
    }));
    expect(merged.evidenceRefs).toContainEqual(expect.objectContaining({
      id: "e2",
      sourceType: "event",
      kind: "note"
    }));
    expect(merged.provenance?.goal).toContainEqual(expect.objectContaining({
      id: "doc1",
      sourceType: "document",
      key: "doc:goal"
    }));
    expect(merged.provenance?.volatileContext).toContainEqual(expect.objectContaining({
      value: "Status update: queue is stable"
    }));
    expect(merged.recentChanges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          field: "goal",
          value: "ship alpha"
        }),
        expect.objectContaining({
          field: "volatileContext",
          value: "Note: keep digest reports small"
        })
      ])
    );
  });

  it("reaffirms semantically equivalent goals without replacing provenance", () => {
    const merged = protectedStateMerge({
      prevState: {
        stableFacts: { goal: "ship a self hosted memory runtime", constraints: [], decisions: [] },
        workingNotes: {},
        todos: [],
        provenance: {
          goal: [{ id: "doc-old", sourceType: "document", key: "doc:goal" }]
        },
        recentChanges: [],
        evidenceRefs: []
      },
      documents: [
        event({ id: "doc-new", scopeId: "sc", userId: "u", type: "document", key: "doc:goal", content: "goal: ship a self-hosted memory runtime" })
      ],
      deltaCandidates: []
    });

    expect(merged.stableFacts.goal).toBe("ship a self hosted memory runtime");
    expect(merged.provenance?.goal).toEqual([
      { id: "doc-old", sourceType: "document", key: "doc:goal" },
      { id: "doc-new", sourceType: "document", key: "doc:goal" }
    ]);
    expect(merged.recentChanges).toContainEqual(
      expect.objectContaining({
        field: "goal",
        action: "reaffirm",
        value: "ship a self hosted memory runtime"
      })
    );
  });

  it("records goal replacement as remove plus set and resets goal provenance", () => {
    const merged = protectedStateMerge({
      prevState: {
        stableFacts: { goal: "ship alpha", constraints: [], decisions: [] },
        workingNotes: {},
        todos: [],
        provenance: {
          goal: [{ id: "doc-old", sourceType: "document", key: "doc:goal" }]
        },
        recentChanges: [],
        evidenceRefs: []
      },
      documents: [
        event({ id: "doc-new", scopeId: "sc", userId: "u", type: "document", key: "doc:goal", content: "goal: ship beta runtime" })
      ],
      deltaCandidates: []
    });

    expect(merged.stableFacts.goal).toBe("ship beta runtime");
    expect(merged.provenance?.goal).toEqual([
      { id: "doc-new", sourceType: "document", key: "doc:goal" }
    ]);
    expect(merged.recentChanges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          field: "goal",
          action: "remove",
          value: "ship alpha"
        }),
        expect.objectContaining({
          field: "goal",
          action: "set",
          value: "ship beta runtime"
        })
      ])
    );
  });

  it("supersedes document-backed constraints and todos when the same document key changes", () => {
    const merged = protectedStateMerge({
      prevState: {
        stableFacts: {
          goal: "ship alpha",
          constraints: ["self-hosted first", "keep api stable"],
          decisions: []
        },
        workingNotes: {},
        todos: ["ship runtime", "publish benchmark report"],
        provenance: {
          constraints: [
            { value: "self-hosted first", refs: [{ id: "doc-old", sourceType: "document", key: "doc:plan" }] },
            { value: "keep api stable", refs: [{ id: "doc-old", sourceType: "document", key: "doc:plan" }] }
          ],
          todos: [
            { value: "ship runtime", refs: [{ id: "doc-old", sourceType: "document", key: "doc:plan" }] },
            { value: "publish benchmark report", refs: [{ id: "doc-old", sourceType: "document", key: "doc:plan" }] }
          ]
        },
        recentChanges: [],
        evidenceRefs: []
      },
      documents: [
        event({
          id: "doc-new",
          scopeId: "sc",
          userId: "u",
          type: "document",
          key: "doc:plan",
          content: "constraint: self-hosted first\ntodo: ship runtime"
        })
      ],
      deltaCandidates: []
    });

    expect(merged.stableFacts.constraints).toEqual(["self-hosted first"]);
    expect(merged.todos).toEqual(["ship runtime"]);
    expect(merged.recentChanges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: "constraints", action: "remove", value: "keep api stable" }),
        expect.objectContaining({ field: "constraints", action: "reaffirm", value: "self-hosted first" }),
        expect.objectContaining({ field: "todos", action: "remove", value: "publish benchmark report" }),
        expect.objectContaining({ field: "todos", action: "reaffirm", value: "ship runtime" })
      ])
    );
  });

  it("supersedes document-backed decisions when the same document key changes", () => {
    const merged = protectedStateMerge({
      prevState: {
        stableFacts: {
          goal: "ship alpha",
          constraints: [],
          decisions: ["use postgres", "ship cli first"]
        },
        workingNotes: {},
        todos: [],
        provenance: {
          decisions: [
            { value: "use postgres", refs: [{ id: "doc-old", sourceType: "document", key: "doc:plan" }] },
            { value: "ship cli first", refs: [{ id: "doc-old", sourceType: "document", key: "doc:plan" }] }
          ]
        },
        recentChanges: [],
        evidenceRefs: []
      },
      documents: [
        event({
          id: "doc-new",
          scopeId: "sc",
          userId: "u",
          type: "document",
          key: "doc:plan",
          content: "decision: use postgres"
        })
      ],
      deltaCandidates: []
    });

    expect(merged.stableFacts.decisions).toEqual(["use postgres"]);
    expect(merged.recentChanges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: "decisions", action: "remove", value: "ship cli first" }),
        expect.objectContaining({ field: "decisions", action: "reaffirm", value: "use postgres" })
      ])
    );
  });

  it("does not remove constraints or todos backed by non-document evidence when a document changes", () => {
    const merged = protectedStateMerge({
      prevState: {
        stableFacts: {
          goal: "ship alpha",
          constraints: ["self-hosted first", "keep api stable"],
          decisions: []
        },
        workingNotes: {},
        todos: ["ship runtime", "publish benchmark report"],
        provenance: {
          constraints: [
            { value: "self-hosted first", refs: [{ id: "doc-old", sourceType: "document", key: "doc:plan" }] },
            { value: "keep api stable", refs: [{ id: "evt-1", sourceType: "event", kind: "constraint" }] }
          ],
          todos: [
            { value: "ship runtime", refs: [{ id: "doc-old", sourceType: "document", key: "doc:plan" }] },
            { value: "publish benchmark report", refs: [{ id: "evt-2", sourceType: "event", kind: "todo" }] }
          ]
        },
        recentChanges: [],
        evidenceRefs: []
      },
      documents: [
        event({
          id: "doc-new",
          scopeId: "sc",
          userId: "u",
          type: "document",
          key: "doc:plan",
          content: "constraint: self-hosted first\ntodo: ship runtime"
        })
      ],
      deltaCandidates: []
    });

    expect(merged.stableFacts.constraints).toEqual(expect.arrayContaining(["self-hosted first", "keep api stable"]));
    expect(merged.todos).toEqual(expect.arrayContaining(["ship runtime", "publish benchmark report"]));
    expect(merged.recentChanges).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: "constraints", action: "remove", value: "keep api stable" }),
        expect.objectContaining({ field: "todos", action: "remove", value: "publish benchmark report" })
      ])
    );
  });

  it("removes the most similar decision instead of blindly removing the last one", () => {
    const merged = protectedStateMerge({
      prevState: {
        stableFacts: {
          goal: "ship alpha",
          constraints: [],
          decisions: ["use postgres for storage", "ship cli first"]
        },
        workingNotes: {},
        todos: [],
        provenance: {
          decisions: [
            { value: "use postgres for storage", refs: [{ id: "evt-old", sourceType: "event", kind: "decision" }] },
            { value: "ship cli first", refs: [{ id: "evt-old-2", sourceType: "event", kind: "decision" }] }
          ]
        },
        recentChanges: [],
        evidenceRefs: []
      },
      documents: [],
      deltaCandidates: [
        {
          eventId: "evt-revoke",
          reason: "stable_fact_signal",
          features: { kind: "decision", importanceScore: 0.9, noveltyScore: 0.9 },
          event: event({
            id: "evt-revoke",
            scopeId: "sc",
            userId: "u",
            type: "stream",
            content: "Revoke use postgres for storage"
          })
        }
      ]
    });

    expect(merged.stableFacts.decisions).toEqual(["ship cli first"]);
    expect(merged.recentChanges).toContainEqual(
      expect.objectContaining({ field: "decisions", action: "remove", value: "use postgres for storage" })
    );
  });

  it("normalizes legacy string evidence refs from previous snapshots", () => {
    const normalized = normalizeDigestState({
      stableFacts: { decisions: [] },
      workingNotes: {},
      todos: [],
      volatileContext: [],
      evidenceRefs: ["doc:goal", "e1"] as any
    });

    expect(normalized.evidenceRefs).toEqual([
      { id: "doc:goal", sourceType: "document", key: "doc:goal" },
      { id: "e1", sourceType: "event" }
    ]);
  });

  it("normalizes provenance and recent changes from previous snapshots", () => {
    const normalized = normalizeDigestState({
      stableFacts: { decisions: [] },
      workingNotes: {},
      todos: [],
      volatileContext: [],
      evidenceRefs: [],
      provenance: {
        goal: ["doc:goal"] as any,
        todos: [{ value: "ship runtime", refs: ["e1"] }] as any
      },
      recentChanges: [
        { field: "goal", action: "set", value: "ship alpha", evidence: "doc:goal" },
        { field: "todos", action: "add", value: "ship runtime", evidence: "e1" }
      ] as any
    });

    expect(normalized.provenance?.goal).toEqual([{ id: "doc:goal", sourceType: "document", key: "doc:goal" }]);
    expect(normalized.provenance?.todos).toEqual([
      {
        value: "ship runtime",
        refs: [{ id: "e1", sourceType: "event" }]
      }
    ]);
    expect(normalized.recentChanges).toEqual([
      {
        field: "goal",
        action: "set",
        value: "ship alpha",
        evidence: { id: "doc:goal", sourceType: "document", key: "doc:goal" }
      },
      {
        field: "todos",
        action: "add",
        value: "ship runtime",
        evidence: { id: "e1", sourceType: "event" }
      }
    ]);
  });
});

describe("consistencyCheck", () => {
  it("catches contradictions and vague next steps", () => {
    const result = consistencyCheck({
      output: {
        summary: "goal: rewrite everything now",
        changes: ["same change"],
        nextSteps: ["clarify"]
      },
      previousDigest: {
        id: "d1",
        scopeId: "sc",
        summary: "old",
        changes: "- same change",
        nextSteps: ["test api"],
        createdAt: new Date()
      },
      protectedState: {
        stableFacts: { goal: "ship alpha", constraints: [], decisions: [] },
        workingNotes: {},
        todos: []
      }
    });

    expect(result.ok).toBe(false);
    expect(result.errors).toContain("goal_contradiction");
    expect(result.errors).toContain("changes_repeated_from_previous_digest");
    expect(result.errors).toContain("vague_next_step");
  });

  it("catches decision and todo contradictions against protected state", () => {
    const result = consistencyCheck({
      output: {
        summary: "We should revert the postgres choice and remove benchmark coverage.",
        changes: [
          "Revert use postgres for storage",
          "Remove define drift metrics from the roadmap"
        ],
        nextSteps: ["Document replacement storage plan"]
      },
      protectedState: {
        stableFacts: {
          goal: "ship alpha",
          constraints: [],
          decisions: ["use postgres for storage"]
        },
        workingNotes: {},
        todos: ["define drift metrics"]
      }
    });

    expect(result.ok).toBe(false);
    expect(result.errors).toContain("decision_contradiction");
    expect(result.errors).toContain("todo_contradiction");
  });

  it("catches goal and constraint omissions when protected facts disappear entirely", () => {
    const result = consistencyCheck({
      output: {
        summary: "Worked on benchmark polish and queue cleanup.",
        changes: ["Updated benchmark markdown output"],
        nextSteps: ["Write queue latency notes"]
      },
      protectedState: {
        stableFacts: {
          goal: "ship low drift memory runtime",
          constraints: ["self-hosted first", "keep api stable"],
          decisions: []
        },
        workingNotes: {},
        todos: []
      }
    });

    expect(result.ok).toBe(true);
    expect(result.warnings).toContain("goal_omission");
    expect(result.warnings).toContain("constraint_omission");
  });

  it("catches decision and todo omissions when durable state disappears from the digest", () => {
    const result = consistencyCheck({
      output: {
        summary: "Worked on benchmark polish and queue cleanup.",
        changes: ["Updated benchmark markdown output"],
        nextSteps: ["Write queue latency notes"]
      },
      protectedState: {
        stableFacts: {
          goal: "ship low drift memory runtime",
          constraints: [],
          decisions: ["use postgres for storage"]
        },
        workingNotes: {},
        todos: ["define drift metrics"]
      }
    });

    expect(result.ok).toBe(true);
    expect(result.warnings).toContain("decision_omission");
    expect(result.warnings).toContain("todo_omission");
  });
});

describe("generateDigestStage2", () => {
  it("retries after invalid output and succeeds with mocked llm", async () => {
    const responses = [
      "{\"summary\":\"too short\",\"changes\":[\"same\"],\"nextSteps\":[\"clarify\"]}",
      "{\"summary\":\"Shipped API endpoints and investigated queue performance.\",\"changes\":[\"Added endpoint tests\"],\"nextSteps\":[\"Write benchmark script for queue latency\"]}"
    ];
    const llm = {
      chat: async () => responses.shift() as string
    };

    const result = await generateDigestStage2({
      scope: { id: "s", userId: "u", name: "Demo", goal: "ship alpha", stage: "build", createdAt: new Date() },
      lastDigest: null,
      protectedState: { stableFacts: { goal: "ship alpha", constraints: [], decisions: [] }, workingNotes: {}, todos: [] },
      deltaCandidates: [],
      documents: [],
      llm,
      systemPrompt: "system",
      userPromptTemplate: "{{scopeName}} {{lastDigest}} {{protectedState}} {{deltaCandidates}} {{documents}}",
      maxRetries: 1
    });

    expect(result.nextSteps[0]).toContain("Write benchmark script");
  });

  it("returns no-change digest when only repeated changes are detected", async () => {
    const llm = {
      chat: async () => "{\"summary\":\"ok\",\"changes\":[\"same change\"],\"nextSteps\":[\"Test pipeline\"]}"
    };

    const result = await generateDigestStage2({
      scope: { id: "s", userId: "u", name: "Demo", goal: "ship alpha", stage: "build", createdAt: new Date() },
      lastDigest: {
        id: "d1",
        scopeId: "s",
        summary: "goal: ship alpha",
        changes: "- same change",
        nextSteps: ["Test pipeline"],
        createdAt: new Date()
      },
      protectedState: { stableFacts: { goal: "ship alpha", constraints: [], decisions: [] }, workingNotes: {}, todos: [] },
      deltaCandidates: [],
      documents: [],
      llm,
      systemPrompt: "system",
      userPromptTemplate: "{{scopeName}} {{lastDigest}} {{protectedState}} {{deltaCandidates}} {{documents}}",
      maxRetries: 0
    });

    expect(result.changes.length).toBe(0);
    expect(result.summary).toContain("goal: ship alpha");
  });
});
