// The fact registry: promotion, retirement, supersession, and the deterministic
// note write path. Split out of digest-control.ts (2026-08-28) — bodies moved verbatim.
import { getDefaultFacetPack, getFacetCap, getFacetDisplayGroup, type FacetPack } from "../facet-registry";
import { computeFactKey } from "./fact-key";
import { isNoteRevision, sameFactCjkAware } from "./similarity";
import { createDefaultNowFactory } from "./state";
import type { DigestEvidenceRef, DigestState, FactRegistryEntry } from "./types";

export function isInFactRegistry(state: DigestState, content: string): boolean {
  return (state.factRegistry ?? []).some(
    (entry) => !entry.supersededBy && sameFactCjkAware(entry.content, content, 0.6)
  );
}

export function getActiveFactRegistry(state: DigestState): FactRegistryEntry[] {
  return (state.factRegistry ?? []).filter((entry) => !entry.supersededBy && !entry.retiredAt);
}

/**
 * The longest a single fact may be.
 *
 * Three paths used to promote `event.content` verbatim — profile facets,
 * decisions, constraints. With a chat message that reads fine, because a message
 * is about the size of a statement. With a session or a document it is not: the
 * fact layer becomes a second copy of the corpus, and since every consumer of it
 * works against a context budget, those copies crowd out the facts that
 * extraction actually produced. Measured on LongMemEval at session granularity:
 * 87% of registry entries over 1000 tokens, median 2691, against extracted facts
 * of 11-27 tokens — a ratio near 100:1.
 *
 * 500 characters is a generous sentence and a small fraction of any document, so
 * the bound separates the two cases without needing to know which one it is in.
 */
export const MAX_FACT_CHARS = 500;

/**
 * Whether a value is a statement rather than a document.
 *
 * This sits on what gets written, not on the event it came from: a long
 * conversation that yields a short fact is the normal case and must still pass.
 */
export function isFactSized(content: string): boolean {
  return content.trim().length <= MAX_FACT_CHARS;
}

/**
 * Retire a fact instead of deleting it.
 *
 * Capacity eviction used to `splice()` the registry record out entirely, which
 * destroyed the very audit chain that supersession exists to provide: the fact
 * had been believed, and then there was no record it ever had been. A retired
 * fact stays on the record with a timestamp and a reason; it simply stops being
 * active.
 */
export function retireFact(
  state: DigestState,
  content: string,
  reason: string,
  makeNow: () => string = createDefaultNowFactory(),
  /**
   * `exact` must be used wherever the fact was stored verbatim with exact-match
   * dedup — notably notes. The fuzzy matcher strips short numeric tokens, so
   * "API v1 key…" and "API v2 key…" look identical to it and the wrong entry
   * would be retired.
   */
  options?: {
    exact?: boolean;
    /** Only consider entries of this facet (entries with no facet still match). */
    facet?: string;
    /** Never retire an entry this returns true for (e.g. a caller-written note). */
    exclude?: (entry: FactRegistryEntry) => boolean;
  }
): void {
  if (!state.factRegistry) return;
  const normalizeExact = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase();
  const matches = options?.exact
    ? (entryContent: string) => normalizeExact(entryContent) === normalizeExact(content)
    : (entryContent: string) => sameFactCjkAware(entryContent, content, 0.6);

  const target = state.factRegistry.find(
    (entry) =>
      !entry.supersededBy &&
      !entry.retiredAt &&
      (options?.facet === undefined || !entry.facet || entry.facet === options.facet) &&
      !(options?.exclude?.(entry) ?? false) &&
      matches(entry.content)
  );
  if (!target) return;
  target.retiredAt = makeNow();
  target.retiredReason = reason;
}

export function promoteToFactRegistry(
  state: DigestState,
  content: string,
  type: FactRegistryEntry["type"],
  confidence: number,
  evidence: DigestEvidenceRef,
  makeId: () => string,
  facet?: string,
  makeNow: () => string = createDefaultNowFactory(),
  entities?: string[]
): void {
  if (!state.factRegistry) state.factRegistry = [];
  if (isInFactRegistry(state, content)) return;
  // Backstop. Every caller checks already; this makes it impossible for a new
  // one to put a document in the registry by forgetting to.
  if (!isFactSized(content)) return;
  const entry: FactRegistryEntry = {
    id: makeId(),
    content,
    type,
    confidence,
    addedAt: makeNow(),
    evidenceId: evidence.id,
    evidenceType: evidence.sourceType
  };
  if (facet !== undefined) entry.facet = facet;
  if (entities?.length) entry.entities = entities;
  state.factRegistry.push(entry);
}

export function supersedeFact(
  state: DigestState,
  content: string,
  newContent: string,
  evidence: DigestEvidenceRef,
  makeId: () => string,
  overrides?: { facet?: string; confidence?: number; type?: FactRegistryEntry["type"]; entities?: string[] },
  makeNow: () => string = createDefaultNowFactory(),
  /** `exclude`: never supersede an entry this returns true for (e.g. a caller-written note). */
  options?: { exclude?: (entry: FactRegistryEntry) => boolean }
): void {
  if (!state.factRegistry) return;
  const toSupersede = state.factRegistry.find(
    (entry) =>
      !entry.supersededBy && !(options?.exclude?.(entry) ?? false) && sameFactCjkAware(entry.content, content, 0.6)
  );
  if (!toSupersede) return;
  const newId = makeId();
  toSupersede.supersededBy = newId;
  const newEntry: FactRegistryEntry = {
    id: newId,
    content: newContent,
    type: overrides?.type ?? toSupersede.type,
    confidence: overrides?.confidence ?? toSupersede.confidence,
    addedAt: makeNow(),
    evidenceId: evidence.id,
    evidenceType: evidence.sourceType
  };
  if (overrides?.facet !== undefined) newEntry.facet = overrides.facet;
  if (overrides?.entities?.length) newEntry.entities = overrides.entities;
  state.factRegistry.push(newEntry);
}


/** The facet the deterministic note write path (`addNoteFact`) writes to. */
export const NOTES_FACET = "notes";

/** `FactRegistryEntry.origin` of a note written by a caller through `addNoteFact`. */
export const CALLER_NOTE_ORIGIN = "note";

/** Confidence `addNoteFact` stamps on a caller note. Digest-produced facts carry 0.6/0.85. */
const CALLER_NOTE_CONFIDENCE = 0.9;

const normalizeNote = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase();

/**
 * Whether a registry entry is a note a caller wrote (remember / POST note), as
 * opposed to one a digest extracted.
 *
 * Entries written since `origin` existed carry it. Older caller notes do not,
 * but `addNoteFact` has always written them the same way — facet `notes`,
 * confidence 0.9 — and no digest path writes that confidence (stream evidence
 * is 0.6, document evidence 0.85), so the shape identifies them.
 */
export function isCallerNoteEntry(entry: FactRegistryEntry): boolean {
  if (entry.origin !== undefined) return entry.origin === CALLER_NOTE_ORIGIN;
  return entry.type === "profile" && entry.facet === NOTES_FACET && entry.confidence === CALLER_NOTE_CONFIDENCE;
}

/** Whether `text`, as held in `profile[facet]`, is backed by an active caller-note entry. */
export function isCallerNoteText(state: DigestState, facet: string, text: string): boolean {
  const target = normalizeNote(text);
  return (state.factRegistry ?? []).some(
    (e) =>
      !e.supersededBy &&
      !e.retiredAt &&
      e.facet === facet &&
      isCallerNoteEntry(e) &&
      normalizeNote(e.content) === target
  );
}

/**
 * Takes forgotten notes out of the active set: their strings leave
 * `profile.notes` (freeing their cap slots) and their registry entries are
 * stamped `retiredAt` / `retiredReason: "forgotten"` — retired, never deleted,
 * so the record that the note was once held survives.
 *
 * `forget` used to only insert a ForgottenFact row: `facts()` hid the note but
 * it kept its slot, so a full notes facet stayed full and the next note evicted
 * a live one. Matching is by display-fact key, the same key `forget` records.
 *
 * @returns how many notes were removed or retired (0 means the state is unchanged).
 */
export function retireForgottenNotes(
  state: DigestState,
  forgottenKeys: ReadonlySet<string>,
  makeNow: () => string = createDefaultNowFactory(),
  pack: FacetPack = getDefaultFacetPack()
): number {
  if (forgottenKeys.size === 0) return 0;
  const group = getFacetDisplayGroup(pack, NOTES_FACET);
  if (!group) return 0;
  const isForgotten = (text: string) => forgottenKeys.has(computeFactKey(group, text));

  let changed = 0;
  const profileMap = state.profile as Record<string, string[]> | undefined;
  const notes = profileMap?.[NOTES_FACET];
  if (profileMap && Array.isArray(notes)) {
    const kept = notes.filter((note) => !isForgotten(note));
    changed += notes.length - kept.length;
    profileMap[NOTES_FACET] = kept;
  }

  const now = makeNow();
  for (const entry of state.factRegistry ?? []) {
    if (entry.supersededBy || entry.retiredAt || entry.facet !== NOTES_FACET) continue;
    if (!isForgotten(entry.content)) continue;
    entry.retiredAt = now;
    entry.retiredReason = "forgotten";
    changed += 1;
  }
  return changed;
}

/** Result of `addNoteFact`: whether the state changed, and — when the note
 * superseded an active revision — the content of the note it replaced. */
export interface AddNoteResult {
  changed: boolean;
  superseded?: string;
}

/**
 * Deterministically writes a user-supplied note to `state.profile.notes`.
 *
 * - No-op (`changed: false`) when an exactly-identical (normalized) note already exists.
 *   Dedup uses EXACT normalized match (trim + collapse whitespace + lowercase),
 *   never fuzzy Jaccard: the fuzzy tokenizer strips short numeric tokens
 *   (< 3 digits), so "API v1 key…" and "API v2 key…" would otherwise collapse to the
 *   same token set and be silently merged — losing user data.
 * - Supersession: when the note reads as a REVISION of an active note
 *   (`isNoteRevision`: short-token-preserving Jaccard ≥ 0.7 with the ASCII-divergence
 *   guard), it replaces that note in the active set and the registry chains
 *   old → new via `supersededBy`. This is the deterministic write-path
 *   counterpart of the digest path's `supersedeFact`, and it is safe where fuzzy
 *   dedup was not: the superseded note stays on the record, marked, never deleted.
 * - Enforces the `notes` cap (30); evicts the oldest entry (index 0) and retires
 *   its factRegistry record when the cap is reached.
 * - Promotes the note to the factRegistry as a `profile/notes` entry with
 *   confidence 0.9 and `origin: "note"` so it surfaces via `flattenScopeFacts`
 *   with its timestamp, and so the digest path knows a caller wrote it (a
 *   digest may never evict, rewrite or consolidate a caller note).
 * - With `forgottenKeys`, retires forgotten notes still holding a slot first
 *   (`retireForgottenNotes`), before the dedup and cap checks.
 */
export function addNoteFact(
  state: DigestState,
  text: string,
  makeId: () => string,
  makeNow: () => string = createDefaultNowFactory(),
  pack: FacetPack = getDefaultFacetPack(),
  /**
   * The scope's forgotten fact keys. When given, forgotten notes still holding
   * a slot (stores written before forget retired them) are retired first, so
   * an existing store heals on its next write instead of evicting a live note.
   */
  forgottenKeys?: ReadonlySet<string>
): AddNoteResult {
  const value = text.trim();
  if (!value) return { changed: false };

  // Heal before anything reads the active set: the dedup, revision and cap
  // checks below must all see the notes with forgotten ones already gone.
  const healed = forgottenKeys ? retireForgottenNotes(state, forgottenKeys, makeNow, pack) > 0 : false;

  // Normalize helper: trim, collapse internal whitespace, lowercase.
  const norm = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase();

  // Idempotency: no-op if an exactly-identical (normalized) note already exists.
  // Explicit notes must use exact match — fuzzy dedup would silently merge notes
  // differing only by short numeric tokens (e.g. "API v1 key…" vs "API v2 key…").
  const existingNotes = state.profile?.notes ?? [];
  if (existingNotes.some((note) => norm(note) === norm(value))) return { changed: healed };

  // Lazy-init profile and notes array.
  if (!state.profile) state.profile = {};
  const profileMap = state.profile as Record<string, string[]>;
  if (!profileMap.notes) profileMap.notes = [];
  const notes = profileMap.notes;
  if (!state.factRegistry) state.factRegistry = [];

  const registerNote = (supersedes?: FactRegistryEntry): string => {
    const id = makeId();
    const entry: FactRegistryEntry = {
      id,
      content: value,
      type: "profile" as const,
      confidence: 0.9,
      addedAt: makeNow(),
      evidenceId: makeId(),
      evidenceType: "event" as const,
      facet: NOTES_FACET,
      origin: CALLER_NOTE_ORIGIN
    };
    state.factRegistry!.push(entry);
    if (supersedes) supersedes.supersededBy = id;
    return id;
  };

  // Supersession: a new note that reads as a revision of an active note replaces
  // it in place instead of accumulating beside it. Matching runs over
  // `profile.notes` (the active set by construction), so retired and superseded
  // versions can never be matched again.
  const revisionIdx = notes.findIndex((note) => isNoteRevision(note, value));
  if (revisionIdx !== -1) {
    const superseded = notes[revisionIdx];
    notes[revisionIdx] = value;
    const oldEntry = state.factRegistry.find(
      (e) => !e.supersededBy && !e.retiredAt && e.facet === "notes" && norm(e.content) === norm(superseded)
    );
    registerNote(oldEntry);
    return { changed: true, superseded };
  }

  // Cap enforcement: evict the oldest entry (index 0) and retire its registry
  // record. Retiring rather than deleting keeps the audit chain intact — the
  // note stops being active, but the record that it was once held remains.
  const cap = getFacetCap(pack, "notes");
  if (notes.length >= cap) {
    const [evicted] = notes.splice(0, 1);
    if (evicted) retireFact(state, evicted, "cap_evicted", makeNow, { exact: true, facet: NOTES_FACET });
  }

  notes.push(value);

  // Promote to factRegistry so flattenScopeFacts surfaces createdAt + evidenceId.
  // Notes use exact-match dedup for the registry guard: the shared promoteToFactRegistry
  // helper calls isInFactRegistry which uses fuzzy Jaccard, which would prevent distinct
  // notes like "note-1" from being registered if a fuzzy-similar "note-0" already exists.
  // Instead, push directly with a facet-scoped exact-match guard.
  // Retired entries do not count: a note that was cap-evicted and is now
  // written again must get a live registry entry, or it would sit in
  // profile.notes with nothing active behind it.
  const alreadyRegistered = state.factRegistry.some(
    (e) => !e.supersededBy && !e.retiredAt && e.facet === "notes" && norm(e.content) === norm(value)
  );
  if (!alreadyRegistered) registerNote();

  return { changed: true };
}
