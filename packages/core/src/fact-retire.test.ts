import { describe, it, expect } from "vitest";
import {
  getActiveFactRegistry,
  retireFact,
  addNoteFact,
  isCallerNoteEntry,
  retireForgottenNotes,
  type DigestState,
  type FactRegistryEntry
} from "./digest-control";
import { computeFactKey } from "./memory-facts";

const NOW = () => "2026-08-05T00:00:00.000Z";

function entry(overrides: Partial<FactRegistryEntry> = {}): FactRegistryEntry {
  return {
    id: "f1",
    content: "旧事实",
    type: "profile",
    confidence: 0.7,
    addedAt: "2026-01-01T00:00:00.000Z",
    evidenceId: "e1",
    evidenceType: "event",
    facet: "notes",
    ...overrides
  };
}

function stateWith(entries: FactRegistryEntry[]): DigestState {
  return { stableFacts: {}, factRegistry: entries } as unknown as DigestState;
}

describe("fact retirement", () => {
  it("keeps a retired fact on the record but out of the active set", () => {
    const state = stateWith([entry()]);

    retireFact(state, "旧事实", "cap_evicted", NOW);

    expect(state.factRegistry).toHaveLength(1);
    expect(state.factRegistry![0].retiredAt).toBe("2026-08-05T00:00:00.000Z");
    expect(state.factRegistry![0].retiredReason).toBe("cap_evicted");
    expect(getActiveFactRegistry(state)).toHaveLength(0);
  });

  it("does not retire an already-superseded entry", () => {
    const state = stateWith([entry({ supersededBy: "f2" }), entry({ id: "f2", content: "新事实" })]);

    retireFact(state, "旧事实", "cap_evicted", NOW);

    expect(state.factRegistry![0].retiredAt).toBeUndefined();
  });

  it("is a no-op when the fact is not in the registry", () => {
    const state = stateWith([entry()]);

    expect(() => retireFact(state, "从未存在的事实", "cap_evicted", NOW)).not.toThrow();
    expect(getActiveFactRegistry(state)).toHaveLength(1);
  });

  it("capacity eviction retires the registry record rather than deleting it", () => {
    const state = { stableFacts: {}, factRegistry: [], profile: { notes: [] } } as unknown as DigestState;
    let n = 0;
    const cap = 30;

    for (let i = 0; i < cap + 1; i++) {
      // Each note gets its own CJK topic character: notes differing only by an
      // index amid identical context would (correctly) supersede each other
      // under note-revision matching, and this test needs cap+1 distinct notes.
      const topic = String.fromCharCode(0x4e00 + i * 13);
      addNoteFact(state, `主题${topic}的笔记`, () => `id-${n++}`, NOW);
    }

    const retired = state.factRegistry!.filter((e) => e.retiredAt);
    expect(retired).toHaveLength(1);
    expect(retired[0].retiredReason).toBe("cap_evicted");
    // The audit chain survives: the record is still there, just inactive.
    expect(state.factRegistry).toHaveLength(cap + 1);
    expect(getActiveFactRegistry(state)).toHaveLength(cap);
  });
});

// Distinct CJK topic per note so note-revision matching never merges two of them.
const noteText = (i: number) => `主题${String.fromCharCode(0x4e00 + i * 13)}的笔记`;
const fillNotes = (count: number) => {
  const state = { stableFacts: {}, factRegistry: [], profile: { notes: [] } } as unknown as DigestState;
  let n = 0;
  for (let i = 0; i < count; i++) addNoteFact(state, noteText(i), () => `id-${n++}`, NOW);
  return state;
};
const notesOf = (state: DigestState) => (state.profile as Record<string, string[]>).notes;

describe("forgotten notes free their slots", () => {
  const NOTES_GROUP = "Notes";

  it("retireForgottenNotes removes the string and retires (never deletes) the entry", () => {
    const state = fillNotes(3);
    const before = state.factRegistry!.length;

    const changed = retireForgottenNotes(state, new Set([computeFactKey(NOTES_GROUP, noteText(1))]), NOW);

    expect(changed).toBe(2); // one profile string + one registry entry
    expect(notesOf(state)).toEqual([noteText(0), noteText(2)]);
    expect(state.factRegistry).toHaveLength(before);
    const retired = state.factRegistry!.find((e) => e.content === noteText(1))!;
    expect(retired.retiredAt).toBe("2026-08-05T00:00:00.000Z");
    expect(retired.retiredReason).toBe("forgotten");
  });

  it("is a no-op for an empty set or keys that match nothing", () => {
    const state = fillNotes(2);
    expect(retireForgottenNotes(state, new Set(), NOW)).toBe(0);
    expect(retireForgottenNotes(state, new Set(["deadbeefdeadbeef"]), NOW)).toBe(0);
    expect(notesOf(state)).toHaveLength(2);
  });

  it("a full store with a forgotten note heals on the next write instead of evicting a live note", () => {
    // The bug: forget only inserted a ForgottenFact row, so a forgotten note kept
    // its slot and the next write at the cap evicted index 0 — a live note.
    const state = fillNotes(30);
    const forgotten = new Set([computeFactKey(NOTES_GROUP, noteText(5))]);

    const result = addNoteFact(state, "一条全新的笔记内容", () => "new-id", NOW, undefined, forgotten);

    expect(result.changed).toBe(true);
    expect(notesOf(state)).toHaveLength(30);
    expect(notesOf(state)).toContain(noteText(0)); // the oldest live note survives
    expect(notesOf(state)).not.toContain(noteText(5));
    expect(state.factRegistry!.filter((e) => e.retiredReason === "cap_evicted")).toHaveLength(0);
    expect(state.factRegistry!.find((e) => e.content === noteText(5))!.retiredReason).toBe("forgotten");
  });

  it("reports a change when only the healing changed state (duplicate note)", () => {
    const state = fillNotes(3);
    const forgotten = new Set([computeFactKey(NOTES_GROUP, noteText(2))]);
    const result = addNoteFact(state, noteText(0), () => "x", NOW, undefined, forgotten);
    expect(result).toEqual({ changed: true });
    expect(notesOf(state)).toEqual([noteText(0), noteText(1)]);
  });
});

describe("forget, then remember", () => {
  const OLD = "[decision:db] 用 PostgreSQL 存储会话";
  const NEW = "[decision:db] 用 MySQL 存储会话";
  const key = (text: string) => computeFactKey("Notes", text);
  let n = 0;
  const id = () => `x-${n++}`;

  it("a revision of a forgotten note supersedes it, keeping the chain", () => {
    // How a caller updates a note: forget the old one, remember the new one.
    // Once forget retired the note (instead of leaving it in profile.notes),
    // revision matching no longer saw it and the chain broke.
    const state = { stableFacts: {}, factRegistry: [], profile: { notes: [] } } as unknown as DigestState;
    addNoteFact(state, OLD, id, NOW);
    const forgotten = new Set([key(OLD)]);
    retireForgottenNotes(state, forgotten, NOW);

    const result = addNoteFact(state, NEW, id, NOW, undefined, forgotten);

    expect(result).toEqual({ changed: true, superseded: OLD });
    expect(notesOf(state)).toEqual([NEW]);
    const oldEntry = state.factRegistry!.find((e) => e.content === OLD)!;
    const newEntry = state.factRegistry!.find((e) => e.content === NEW)!;
    expect(oldEntry.supersededBy).toBe(newEntry.id);
    expect(oldEntry.retiredReason).toBe("forgotten");
    expect(newEntry.retiredAt).toBeUndefined();
    expect(newEntry.supersededBy).toBeUndefined();
  });

  it("the revision takes one slot and the forgotten note none, even at the cap", () => {
    const state = fillNotes(29);
    addNoteFact(state, OLD, id, NOW);
    const forgotten = new Set([key(OLD)]);
    retireForgottenNotes(state, forgotten, NOW);
    expect(notesOf(state)).toHaveLength(29);

    expect(addNoteFact(state, NEW, id, NOW, undefined, forgotten).superseded).toBe(OLD);

    expect(notesOf(state)).toHaveLength(30);
    expect(notesOf(state)).toContain(noteText(0));
    expect(state.factRegistry!.some((e) => e.retiredReason === "cap_evicted")).toBe(false);
  });

  it("the exact text of a forgotten note stays forgotten and evicts nothing at the cap", () => {
    // Its ForgottenFact row still hides it, so writing it would push a visible
    // note out for something facts() never shows.
    const state = fillNotes(30);
    const forgotten = new Set([key(noteText(5))]);
    retireForgottenNotes(state, forgotten, NOW);
    addNoteFact(state, "a fresh note filling the slot", id, NOW, undefined, forgotten);
    const before = JSON.stringify(state);

    const result = addNoteFact(state, noteText(5), id, NOW, undefined, forgotten);

    expect(result).toEqual({ changed: false });
    expect(JSON.stringify(state)).toBe(before);
    expect(notesOf(state)).toContain(noteText(0));
  });
});

describe("legacy consolidated notes are not caller notes", () => {
  it("excludes a legacy 0.9 note that several sources were merged into", () => {
    const merged = entry({ id: "m", content: "merged note", confidence: 0.9 });
    const registry = [
      entry({ id: "s1", content: "a", confidence: 0.9, supersededBy: "m" }),
      entry({ id: "s2", content: "b", confidence: 0.6, supersededBy: "m" }),
      merged
    ];
    expect(isCallerNoteEntry(merged, registry)).toBe(false);
    expect(isCallerNoteEntry(merged)).toBe(true); // shape alone cannot tell
  });

  it("keeps a legacy caller revision (exactly one source) as a caller note", () => {
    const revised = entry({ id: "r", content: "revised", confidence: 0.9 });
    const registry = [entry({ id: "o", content: "original", confidence: 0.9, supersededBy: "r" }), revised];
    expect(isCallerNoteEntry(revised, registry)).toBe(true);
  });

  it("never applies the exclusion to entries that carry an origin", () => {
    const tagged = entry({ id: "t", confidence: 0.9, origin: "note" });
    const registry = [entry({ id: "a", supersededBy: "t" }), entry({ id: "b", supersededBy: "t" }), tagged];
    expect(isCallerNoteEntry(tagged, registry)).toBe(true);
  });
});

describe("caller notes are tagged", () => {
  it("addNoteFact stamps origin 'note' on the registry entry", () => {
    const state = { stableFacts: {}, factRegistry: [], profile: {} } as unknown as DigestState;
    addNoteFact(state, "deploy on Fridays is banned", () => "n1", NOW);
    expect(state.factRegistry![0]).toMatchObject({ facet: "notes", confidence: 0.9, origin: "note" });
    expect(isCallerNoteEntry(state.factRegistry![0])).toBe(true);
  });

  it("recognises a legacy caller note by shape (facet notes, confidence 0.9, no origin)", () => {
    expect(isCallerNoteEntry(entry({ confidence: 0.9 }))).toBe(true);
    // Digest-produced notes carry stream (0.6) or document (0.85) authority.
    expect(isCallerNoteEntry(entry({ confidence: 0.6 }))).toBe(false);
    expect(isCallerNoteEntry(entry({ confidence: 0.85 }))).toBe(false);
    expect(isCallerNoteEntry(entry({ confidence: 0.9, facet: "goals" }))).toBe(false);
  });

  it("a cap-evicted note written again gets a live registry entry", () => {
    // alreadyRegistered used to count the retired entry, so the re-written note
    // sat in profile.notes with nothing active behind it.
    const state = fillNotes(31);
    expect(state.factRegistry!.find((e) => e.content === noteText(0))!.retiredReason).toBe("cap_evicted");

    addNoteFact(state, noteText(0), () => "again", NOW);

    const live = getActiveFactRegistry(state).filter((e) => e.content === noteText(0));
    expect(live).toHaveLength(1);
    expect(notesOf(state)).toContain(noteText(0));
  });
});
