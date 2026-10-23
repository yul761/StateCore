import { describe, it, expect } from "vitest";
import {
  formatHandoff,
  activeHandoffFromRows,
  handoffRowsToRegistry,
  carryOverConcurrentNotes,
  HANDOFF_FACET,
  type HandoffRow
} from "./handoff";
import { buildFactProvenance } from "./provenance";
import type { DigestState } from "./digest-control";
import { computeFactKey, pruneForgottenFacts } from "./memory-facts";

const row = (partial: Partial<HandoffRow> & Pick<HandoffRow, "id" | "content">): HandoffRow => ({
  createdAt: new Date("2026-08-29T12:00:00Z"),
  supersededBy: null,
  retiredAt: null,
  retiredReason: null,
  ...partial
});

describe("formatHandoff", () => {
  it("composes summary, open questions, and next steps", () => {
    const text = formatHandoff({
      summary: "stopped mid-migration",
      openQuestions: ["flaky or real?"],
      nextSteps: ["wire the controller"]
    });
    expect(text).toContain("stopped mid-migration");
    expect(text).toContain("Open questions:\n- flaky or real?");
    expect(text).toContain("Next steps:\n- wire the controller");
  });
});

describe("activeHandoffFromRows", () => {
  it("returns null for no rows and for all-retired rows", () => {
    expect(activeHandoffFromRows([])).toBeNull();
    expect(activeHandoffFromRows([row({ id: "a", content: "x", retiredAt: new Date() })])).toBeNull();
  });

  it("returns the newest active row with the total stop-point count", () => {
    const rows = [
      row({ id: "a", content: "first", supersededBy: "b", createdAt: new Date("2026-08-01T00:00:00Z") }),
      row({ id: "b", content: "second", createdAt: new Date("2026-08-02T00:00:00Z") })
    ];
    const active = activeHandoffFromRows(rows);
    expect(active).toMatchObject({ id: "b", content: "second", versionCount: 2 });
    expect(active!.addedAt).toBe("2026-08-02T00:00:00.000Z");
  });
});

describe("handoffRowsToRegistry — provenance compatibility", () => {
  it("maps rows so buildFactProvenance walks the stop-point chain", () => {
    const rows = [
      row({ id: "a", content: "first", supersededBy: "b", createdAt: new Date("2026-08-01T00:00:00Z") }),
      row({ id: "b", content: "second", createdAt: new Date("2026-08-02T00:00:00Z") })
    ];
    const registry = handoffRowsToRegistry(rows);
    expect(registry.every((e) => e.facet === HANDOFF_FACET)).toBe(true);
    // A handoff row is its own evidence — no fabricated foreign ids.
    expect(registry[0].evidenceId).toBe("a");

    const state: DigestState = { stableFacts: { decisions: [] }, workingNotes: {}, todos: [], factRegistry: registry, profile: {} };
    const provenance = buildFactProvenance(state, "b");
    expect(provenance?.chain.map((e) => e.id)).toEqual(["a", "b"]);
  });
});

describe("carryOverConcurrentNotes", () => {
  const baseState = (): DigestState => ({
    stableFacts: { decisions: [] },
    workingNotes: {},
    todos: [],
    factRegistry: [],
    profile: {}
  });

  const noteEntry = (id: string, content: string) => ({
    id,
    content,
    type: "profile" as const,
    confidence: 0.9,
    addedAt: "2026-08-29T12:00:00.000Z",
    evidenceId: `${id}-ev`,
    evidenceType: "event" as const,
    facet: "notes"
  });

  it("carries a note written concurrently into the pipeline's state", () => {
    const pipeline = baseState();
    const latest = baseState();
    latest.factRegistry!.push(noteEntry("n1", "written mid-digest"));
    (latest.profile as Record<string, string[]>).notes = ["written mid-digest"];

    const carried = carryOverConcurrentNotes(pipeline, latest);

    expect(carried).toBe(1);
    expect(pipeline.factRegistry!.some((e) => e.id === "n1")).toBe(true);
    expect((pipeline.profile as Record<string, string[]>).notes).toContain("written mid-digest");
  });

  it("does not duplicate entries the pipeline already has, and ignores non-note facets", () => {
    const pipeline = baseState();
    pipeline.factRegistry!.push(noteEntry("n1", "already there"));
    const latest = baseState();
    latest.factRegistry!.push(noteEntry("n1", "already there"));
    latest.factRegistry!.push({ ...noteEntry("g1", "a goal"), facet: "goals" });

    const carried = carryOverConcurrentNotes(pipeline, latest);

    expect(carried).toBe(0);
    expect(pipeline.factRegistry!).toHaveLength(1);
  });

  const withNotes = (entries: ReturnType<typeof noteEntry>[]): DigestState => {
    const state = baseState();
    state.factRegistry!.push(...entries.map((e) => ({ ...e })));
    (state.profile as Record<string, string[]>).notes = entries.map((e) => e.content);
    return state;
  };
  const notesOf = (state: DigestState) => (state.profile as Record<string, string[]>).notes;
  const callerNotes = (count: number) => Array.from({ length: count }, (_, i) => noteEntry(`n${i}`, `caller note ${i}`));
  const NOTES_KEY = (content: string) => computeFactKey("Notes", content);

  it("a full digest frees a forgotten note's slot instead of re-appending it", () => {
    // The bug: the pipeline prunes forgotten notes (deleting their registry
    // entries), so at write time every one of them looked like a concurrent
    // write and was carried straight back — the slot was never freed.
    const latest = withNotes(callerNotes(30));
    const forgotten = new Set([NOTES_KEY("caller note 7")]);
    const pipeline = withNotes(callerNotes(30));
    pruneForgottenFacts(pipeline, forgotten);
    expect(notesOf(pipeline)).toHaveLength(29);

    const carried = carryOverConcurrentNotes(pipeline, latest, { forgottenFactKeys: forgotten });

    expect(carried).toBe(0);
    expect(notesOf(pipeline)).toHaveLength(29);
    expect(notesOf(pipeline)).not.toContain("caller note 7");
  });

  it("keeps the forgotten note's retired record in the written state (why() history survives)", () => {
    const latest = withNotes(callerNotes(3));
    const forgotten = new Set([NOTES_KEY("caller note 1")]);
    const pipeline = withNotes(callerNotes(3));
    pruneForgottenFacts(pipeline, forgotten, undefined, () => "T");

    carryOverConcurrentNotes(pipeline, latest, { forgottenFactKeys: forgotten });

    expect(notesOf(pipeline)).not.toContain("caller note 1");
    expect(pipeline.factRegistry!.find((e) => e.id === "n1")).toMatchObject({ retiredAt: "T", retiredReason: "forgotten" });
  });

  it("retires a forgotten note the pipeline still holds (forget landed mid-digest)", () => {
    const pipeline = withNotes(callerNotes(3));
    const latest = withNotes(callerNotes(3));

    carryOverConcurrentNotes(pipeline, latest, { forgottenFactKeys: new Set([NOTES_KEY("caller note 2")]), makeNow: () => "T" });

    expect(notesOf(pipeline)).toEqual(["caller note 0", "caller note 1"]);
    expect(pipeline.factRegistry!.find((e) => e.id === "n2")).toMatchObject({ retiredAt: "T", retiredReason: "forgotten" });
  });

  it("mirrors a retirement made concurrently in the latest snapshot", () => {
    const pipeline = withNotes(callerNotes(2));
    const latest = withNotes(callerNotes(2));
    Object.assign(latest.factRegistry![0], { retiredAt: "T", retiredReason: "forgotten" });
    notesOf(latest).splice(0, 1);

    carryOverConcurrentNotes(pipeline, latest);

    expect(notesOf(pipeline)).toEqual(["caller note 1"]);
    expect(pipeline.factRegistry![0]).toMatchObject({ retiredAt: "T", retiredReason: "forgotten" });
  });

  it("holds the carried set to the cap, evicting the oldest digest-produced note first", () => {
    const entries = callerNotes(30);
    entries[3] = { ...noteEntry("d3", "digest note"), confidence: 0.6 };
    const pipeline = withNotes(entries);
    const latest = withNotes(entries);
    latest.factRegistry!.push(noteEntry("late", "written mid-digest"));
    notesOf(latest).push("written mid-digest");

    const carried = carryOverConcurrentNotes(pipeline, latest, { makeNow: () => "T" });

    expect(carried).toBe(1);
    expect(notesOf(pipeline)).toHaveLength(30);
    expect(notesOf(pipeline)).toContain("written mid-digest");
    expect(notesOf(pipeline)).toContain("caller note 0");
    expect(notesOf(pipeline)).not.toContain("digest note");
    expect(pipeline.factRegistry!.find((e) => e.id === "d3")).toMatchObject({ retiredReason: "cap_evicted" });
  });

  it("evicts the oldest note when every slot is a caller note", () => {
    const pipeline = withNotes(callerNotes(30));
    const latest = withNotes(callerNotes(30));
    latest.factRegistry!.push(noteEntry("late", "written mid-digest"));

    carryOverConcurrentNotes(pipeline, latest, { makeNow: () => "T" });

    expect(notesOf(pipeline)).toHaveLength(30);
    expect(notesOf(pipeline)[0]).toBe("caller note 1");
    expect(pipeline.factRegistry!.find((e) => e.id === "n0")).toMatchObject({ retiredReason: "cap_evicted" });
  });

  it("leaves the pipeline state untouched when there is nothing to carry", () => {
    const pipeline = baseState();
    delete pipeline.profile;
    carryOverConcurrentNotes(pipeline, baseState(), { forgottenFactKeys: new Set() });
    expect(pipeline.profile).toBeUndefined();
  });
});
