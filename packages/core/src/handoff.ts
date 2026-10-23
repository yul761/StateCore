/**
 * Session handoff as first-class, supersession-tracked rows.
 *
 * A handoff is "where the last session stopped": a summary, the questions
 * still open, and the next steps — written by an agent about to end (or
 * compact) a session, read by whichever agent starts the next one, in the
 * same client or a different vendor's.
 *
 * Handoffs live in their own table (SessionHandoff), deliberately NOT in the
 * digest state snapshot. The first shipped version stored them as registry
 * facts inside the snapshot JSON, and review found three faults with that:
 * a handoff written while a digest ran vanished from the new snapshot's
 * lineage (the snapshot is read-modify-write with no concurrency control);
 * every digest copied the whole handoff history into the new snapshot row;
 * and each entry carried a fabricated evidence id. Rows in a dedicated table
 * are transactional, are written once, and are their own evidence.
 *
 * This module holds the storage-independent parts: formatting, the active-row
 * projection, the mapping that lets `buildFactProvenance` walk a handoff
 * chain, and the digest-time carry-over that closes the same lost-update race
 * for concurrently written notes.
 */
import type { DigestState, FactRegistryEntry } from "./digest-control";
import { computeFactKey } from "./digest/fact-key";
import { isCallerNoteText, NOTES_FACET, retireFact, retireForgottenNotes } from "./digest/fact-registry";
import { createDefaultNowFactory } from "./digest/state";
import { getDefaultFacetPack, getFacetCap, getFacetDisplayGroup, type FacetPack } from "./facet-registry";

/** Reserved facet name; kept for filtering out legacy in-registry entries. */
export const HANDOFF_FACET = "handoff";

export interface HandoffInput {
  summary: string;
  openQuestions?: string[];
  nextSteps?: string[];
}

/** The storage row shape both backends' SessionHandoff tables share. */
export interface HandoffRow {
  id: string;
  content: string;
  createdAt: Date | string;
  supersededBy?: string | null;
  retiredAt?: Date | string | null;
  retiredReason?: string | null;
}

export function formatHandoff(input: HandoffInput): string {
  const lines = [input.summary.trim()];
  const questions = (input.openQuestions ?? []).map((q) => q.trim()).filter(Boolean);
  if (questions.length) {
    lines.push("Open questions:");
    for (const q of questions) lines.push(`- ${q}`);
  }
  const steps = (input.nextSteps ?? []).map((s) => s.trim()).filter(Boolean);
  if (steps.length) {
    lines.push("Next steps:");
    for (const s of steps) lines.push(`- ${s}`);
  }
  return lines.join("\n");
}

export interface ActiveHandoff {
  id: string;
  content: string;
  addedAt: string;
  /** How many stop-points the scope has recorded, retired ones included. */
  versionCount: number;
}

const toIso = (value: Date | string): string => (value instanceof Date ? value.toISOString() : value);

export function activeHandoffFromRows(rows: HandoffRow[]): ActiveHandoff | null {
  const active = rows.filter((r) => !r.supersededBy && !r.retiredAt);
  if (!active.length) return null;
  const latest = active.reduce((a, b) => (toIso(a.createdAt) >= toIso(b.createdAt) ? a : b));
  return { id: latest.id, content: latest.content, addedAt: toIso(latest.createdAt), versionCount: rows.length };
}

/**
 * Maps handoff rows into registry-entry shape so `buildFactProvenance` can
 * walk a stop-point chain exactly the way it walks a fact chain. A row's
 * evidence is the row itself: the handoff statement is agent-authored, not
 * derived from an event, and a self-referential id resolves instead of
 * dangling.
 */
export function handoffRowsToRegistry(rows: HandoffRow[]): FactRegistryEntry[] {
  return rows.map((r) => ({
    id: r.id,
    content: r.content,
    type: "profile" as const,
    confidence: 0.95,
    addedAt: toIso(r.createdAt),
    evidenceId: r.id,
    evidenceType: "event" as const,
    facet: HANDOFF_FACET,
    ...(r.supersededBy ? { supersededBy: r.supersededBy } : {}),
    ...(r.retiredAt ? { retiredAt: toIso(r.retiredAt) } : {}),
    ...(r.retiredReason ? { retiredReason: r.retiredReason } : {})
  }));
}

export interface CarryOverOptions {
  /**
   * The scope's forgotten fact keys. A forgotten note is never carried over,
   * and any forgotten note still active in `pipeline` is retired. Without
   * this, a full digest re-appended every note the pipeline had just pruned
   * as forgotten — the registry ids were gone from the pipeline state, so they
   * looked like concurrent writes — and forgotten notes kept their slots.
   */
  forgottenFactKeys?: ReadonlySet<string>;
  /** The tenant's facet ontology (the notes cap and display group). Defaults to the deployment pack. */
  pack?: FacetPack;
  makeNow?: () => string;
}

/**
 * Closes the digest-side lost-update race for notes: the pipeline reads the
 * latest snapshot, runs for seconds-to-minutes, then CREATES a new snapshot
 * from its in-memory state — a note written to the old snapshot row in that
 * window would silently vanish from the latest lineage. Called at digest
 * write time with the freshly re-read latest state; appends note-facet
 * registry entries (and their active profile strings) the pipeline never saw.
 * Registry entries are append-only, so an id present in `latest` but absent
 * from `pipeline` can only be a concurrent write — unless it was forgotten,
 * which the pipeline prunes and this skips. Scoped to the notes facet, the one
 * deterministic-write path that races the digest by design.
 *
 * A note the pipeline still holds active but `latest` retired or superseded in
 * the meantime (a concurrent forget, cap eviction or revision) leaves the
 * active set here too, and the carried
 * set is held to the notes cap: the oldest digest-produced note goes first,
 * then the oldest note, each retired as `cap_evicted`.
 *
 * @returns how many entries were carried over.
 */
export function carryOverConcurrentNotes(
  pipeline: DigestState,
  latest: DigestState,
  options: CarryOverOptions = {}
): number {
  const pack = options.pack ?? getDefaultFacetPack();
  const makeNow = options.makeNow ?? createDefaultNowFactory();
  const forgotten = options.forgottenFactKeys ?? new Set<string>();
  const group = getFacetDisplayGroup(pack, NOTES_FACET);
  const isForgotten = (content: string) => (group ? forgotten.has(computeFactKey(group, content)) : false);

  // Lazily created: a run with nothing to carry leaves the pipeline state untouched.
  const notes = (): string[] => {
    if (!pipeline.profile) pipeline.profile = {};
    const profileMap = pipeline.profile as Record<string, string[]>;
    if (!profileMap.notes) profileMap.notes = [];
    return profileMap.notes;
  };
  const norm = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase();

  const pipelineById = new Map((pipeline.factRegistry ?? []).map((e) => [e.id, e]));
  let carried = 0;
  for (const entry of latest.factRegistry ?? []) {
    if (entry.facet !== NOTES_FACET) continue;
    const mine = pipelineById.get(entry.id);
    if (mine) {
      // Retired or revised concurrently (a forget, a note write's cap
      // eviction, or a note revision whose replacement is carried below).
      if ((entry.retiredAt || entry.supersededBy) && !mine.retiredAt && !mine.supersededBy) {
        if (entry.supersededBy) mine.supersededBy = entry.supersededBy;
        if (entry.retiredAt) {
          mine.retiredAt = entry.retiredAt;
          mine.retiredReason = entry.retiredReason;
        }
        const list = notes();
        const idx = list.findIndex((n) => norm(n) === norm(mine.content));
        if (idx !== -1) list.splice(idx, 1);
      }
      continue;
    }
    if (isForgotten(entry.content)) continue;
    if (!pipeline.factRegistry) pipeline.factRegistry = [];
    pipeline.factRegistry.push(entry);
    carried += 1;
    if (!entry.supersededBy && !entry.retiredAt && !notes().includes(entry.content)) {
      notes().push(entry.content);
    }
  }

  if (forgotten.size > 0) retireForgottenNotes(pipeline, forgotten, makeNow, pack);

  const cap = getFacetCap(pack, NOTES_FACET);
  const held = (pipeline.profile as Record<string, string[]> | undefined)?.notes;
  while (held && held.length > cap) {
    const digestIdx = held.findIndex((n) => !isCallerNoteText(pipeline, NOTES_FACET, n));
    const [evicted] = held.splice(digestIdx === -1 ? 0 : digestIdx, 1);
    retireFact(pipeline, evicted, "cap_evicted", makeNow, { exact: true, facet: NOTES_FACET });
  }
  return carried;
}
