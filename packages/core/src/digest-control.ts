import { z } from "zod";
import type { Digest, MemoryEvent, ProjectScope } from "./index";

export type MemoryEventKind = "decision" | "constraint" | "todo" | "note" | "status" | "question" | "noise";

export interface EventFeatures {
  kind: MemoryEventKind;
  importanceScore: number;
  noveltyScore: number;
  docKey?: string;
  references?: string[];
}

export interface DigestState {
  stableFacts: {
    goal?: string;
    constraints?: string[];
    decisions: string[];
  };
  workingNotes: {
    openQuestions?: string[];
    risks?: string[];
    context?: string;
  };
  todos: string[];
  volatileContext?: string[];
  evidenceRefs?: DigestEvidenceRef[];
  confidence?: {
    goal?: number;
    constraints?: DigestStateValueConfidence[];
    decisions?: DigestStateValueConfidence[];
    todos?: DigestStateValueConfidence[];
    volatileContext?: DigestStateValueConfidence[];
    openQuestions?: DigestStateValueConfidence[];
    risks?: DigestStateValueConfidence[];
  };
  provenance?: {
    goal?: DigestEvidenceRef[];
    constraints?: DigestStateValueProvenance[];
    decisions?: DigestStateValueProvenance[];
    todos?: DigestStateValueProvenance[];
    volatileContext?: DigestStateValueProvenance[];
    openQuestions?: DigestStateValueProvenance[];
    risks?: DigestStateValueProvenance[];
  };
  recentChanges?: DigestStateChange[];
}

export interface DigestEvidenceRef {
  id: string;
  sourceType: "document" | "event";
  key?: string;
  kind?: MemoryEventKind;
}

export interface DigestStateValueProvenance {
  value: string;
  refs: DigestEvidenceRef[];
}

export interface DigestStateValueConfidence {
  value: string;
  score: number;
}

export interface DigestStateChange {
  field: "goal" | "constraints" | "decisions" | "todos" | "volatileContext" | "openQuestions" | "risks";
  action: "set" | "add" | "remove" | "reaffirm";
  value: string;
  evidence: DigestEvidenceRef;
}

export interface SelectedEvent {
  event: MemoryEvent;
  features: EventFeatures;
}

export interface SelectionResult {
  selectedEvents: SelectedEvent[];
  documents: MemoryEvent[];
  includeLastDigest: boolean;
  rationale: string[];
}

export interface DeltaCandidate {
  eventId: string;
  reason: string;
  features: EventFeatures;
  event: MemoryEvent;
}

export interface DigestControlConfig {
  eventBudgetTotal: number;
  eventBudgetDocs: number;
  eventBudgetStream: number;
  noveltyThreshold: number;
  maxRetries: number;
  useLlmClassifier: boolean;
  debug: boolean;
}

export interface DigestOutput {
  summary: string;
  changes: string[];
  nextSteps: string[];
}

export interface DigestConsistencyResult {
  ok: boolean;
  errors: string[];
  warnings: string[];
}

export const DigestOutputSchema = z.object({
  summary: z.string(),
  changes: z.array(z.string()),
  nextSteps: z.array(z.string())
});

const DEFAULT_DIGEST_STATE: DigestState = {
  stableFacts: { decisions: [] },
  workingNotes: {},
  todos: [],
  volatileContext: [],
  evidenceRefs: [],
  confidence: {},
  provenance: {},
  recentChanges: []
};

function deriveStateFromDigest(digest?: Digest | null): DigestState | null {
  if (!digest) return null;
  const decisions = digest.changes
    .split("\\n")
    .map((line) => line.replace(/^-\\s*/, "").trim())
    .filter((line) => /\\b(decide|decision|we will|agreed)\\b/i.test(line));
  const constraints = digest.changes
    .split("\\n")
    .map((line) => line.replace(/^-\\s*/, "").trim())
    .filter((line) => /\\b(constraint|blocked|limitation)\\b/i.test(line));
  return {
    stableFacts: {
      goal: parseGoal(digest.summary),
      constraints,
      decisions
    },
    workingNotes: {},
    todos: digest.nextSteps ?? [],
    volatileContext: [],
    evidenceRefs: [],
    confidence: {},
    provenance: {},
    recentChanges: []
  };
}

function normalizeEvidenceRef(ref: string | DigestEvidenceRef): DigestEvidenceRef {
  if (typeof ref === "string") {
    return {
      id: ref,
      sourceType: ref.startsWith("doc:") ? "document" : "event",
      ...(ref.startsWith("doc:") ? { key: ref } : {})
    };
  }
  return {
    id: ref.id,
    sourceType: ref.sourceType,
    key: ref.key,
    kind: ref.kind
  };
}

export function normalizeDigestState(state?: DigestState | null): DigestState {
  const base = JSON.parse(JSON.stringify(state ?? DEFAULT_DIGEST_STATE)) as DigestState & {
    evidenceRefs?: Array<string | DigestEvidenceRef>;
    confidence?: {
      goal?: number;
      constraints?: Array<{ value?: string; score?: number }>;
      decisions?: Array<{ value?: string; score?: number }>;
      todos?: Array<{ value?: string; score?: number }>;
      volatileContext?: Array<{ value?: string; score?: number }>;
      openQuestions?: Array<{ value?: string; score?: number }>;
      risks?: Array<{ value?: string; score?: number }>;
    };
    provenance?: {
      goal?: Array<string | DigestEvidenceRef>;
      constraints?: Array<{ value?: string; refs?: Array<string | DigestEvidenceRef> }>;
      decisions?: Array<{ value?: string; refs?: Array<string | DigestEvidenceRef> }>;
      todos?: Array<{ value?: string; refs?: Array<string | DigestEvidenceRef> }>;
      volatileContext?: Array<{ value?: string; refs?: Array<string | DigestEvidenceRef> }>;
      openQuestions?: Array<{ value?: string; refs?: Array<string | DigestEvidenceRef> }>;
      risks?: Array<{ value?: string; refs?: Array<string | DigestEvidenceRef> }>;
    };
    recentChanges?: Array<{ field?: DigestStateChange["field"]; action?: DigestStateChange["action"]; value?: string; evidence?: string | DigestEvidenceRef }>;
  };
  return {
    stableFacts: {
      goal: base.stableFacts?.goal,
      constraints: [...new Set(base.stableFacts?.constraints ?? [])],
      decisions: [...new Set(base.stableFacts?.decisions ?? [])]
    },
    workingNotes: {
      openQuestions: [...new Set(base.workingNotes?.openQuestions ?? [])].slice(-10),
      risks: [...new Set(base.workingNotes?.risks ?? [])].slice(-10),
      context: base.workingNotes?.context
    },
    todos: [...new Set(base.todos ?? [])],
    volatileContext: [...new Set(base.volatileContext ?? [])].slice(-10),
    evidenceRefs: [...new Map((base.evidenceRefs ?? []).map((ref) => {
      const normalized = normalizeEvidenceRef(ref);
      return [`${normalized.sourceType}:${normalized.id}:${normalized.key ?? ""}:${normalized.kind ?? ""}`, normalized];
    })).values()].slice(-50),
    confidence: {
      goal: computeGoalConfidence(base.provenance?.goal),
      constraints: buildConfidenceList(base.provenance?.constraints, base.confidence?.constraints),
      decisions: buildConfidenceList(base.provenance?.decisions, base.confidence?.decisions),
      todos: buildConfidenceList(base.provenance?.todos, base.confidence?.todos),
      volatileContext: buildConfidenceList(base.provenance?.volatileContext, base.confidence?.volatileContext),
      openQuestions: buildConfidenceList(base.provenance?.openQuestions, base.confidence?.openQuestions),
      risks: buildConfidenceList(base.provenance?.risks, base.confidence?.risks)
    },
    provenance: {
      goal: [...new Map(((base.provenance?.goal ?? []) as Array<string | DigestEvidenceRef>).map((ref) => {
        const normalized = normalizeEvidenceRef(ref);
        return [`${normalized.sourceType}:${normalized.id}:${normalized.key ?? ""}:${normalized.kind ?? ""}`, normalized];
      })).values()],
      constraints: normalizeValueProvenanceList(base.provenance?.constraints),
      decisions: normalizeValueProvenanceList(base.provenance?.decisions),
      todos: normalizeValueProvenanceList(base.provenance?.todos),
      volatileContext: normalizeValueProvenanceList(base.provenance?.volatileContext),
      openQuestions: normalizeValueProvenanceList(base.provenance?.openQuestions),
      risks: normalizeValueProvenanceList(base.provenance?.risks)
    },
    recentChanges: normalizeRecentChanges(base.recentChanges)
  };
}

function normalizeValueProvenanceList(entries?: Array<{ value?: string; refs?: Array<string | DigestEvidenceRef> }> | null) {
  const normalized = (entries ?? [])
    .map((entry) => ({
      value: entry?.value?.trim() ?? "",
      refs: [...new Map((entry?.refs ?? []).map((ref) => {
        const item = normalizeEvidenceRef(ref);
        return [`${item.sourceType}:${item.id}:${item.key ?? ""}:${item.kind ?? ""}`, item];
      })).values()]
    }))
    .filter((entry) => entry.value);

  return [...new Map(normalized.map((entry) => [normalizeText(entry.value), entry])).values()].slice(-50);
}

function normalizeRecentChanges(entries?: Array<{
  field?: DigestStateChange["field"];
  action?: DigestStateChange["action"];
  value?: string;
  evidence?: string | DigestEvidenceRef;
}> | null): DigestStateChange[] {
  return (entries ?? [])
    .map((entry) => {
      if (!entry?.field || !entry?.action || !entry?.value || !entry?.evidence) return null;
      return {
        field: entry.field,
        action: entry.action,
        value: entry.value.trim(),
        evidence: normalizeEvidenceRef(entry.evidence)
      };
    })
    .filter((entry): entry is DigestStateChange => Boolean(entry))
    .slice(-25);
}

function normalizeConfidenceList(entries?: Array<{ value?: string; score?: number }> | null) {
  return (entries ?? [])
    .map((entry) => ({
      value: entry?.value?.trim() ?? "",
      score: Number.isFinite(entry?.score) ? Math.max(0, Math.min(1, Number(entry?.score))) : 0
    }))
    .filter((entry) => entry.value)
    .slice(-50);
}

function normalizeText(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9\s:]/g, " ").replace(/\s+/g, " ").trim();
}

function tokenize(value: string) {
  const normalized = normalizeText(value);
  return normalized
    .split(" ")
    .map((token) => token.replace(/:+$/g, ""))
    .filter((token) => token.length > 2)
    .map((token) => {
      if (token === "docs" || token === "doc") return "documentation";
      if (token === "blocker") return "blocked";
      return token;
    });
}

function jaccardSimilarity(a: string, b: string) {
  const tokensA = new Set(tokenize(a));
  const tokensB = new Set(tokenize(b));
  if (tokensA.size === 0 && tokensB.size === 0) return 1;
  const intersection = [...tokensA].filter((token) => tokensB.has(token)).length;
  const union = new Set([...tokensA, ...tokensB]).size;
  return union === 0 ? 0 : intersection / union;
}

function evidenceWeight(ref: DigestEvidenceRef) {
  return ref.sourceType === "document" ? 1 : 0.7;
}

function scoreEvidenceConfidence(refs?: DigestEvidenceRef[] | null) {
  const unique = [...new Map((refs ?? []).map((ref) => [`${ref.sourceType}:${ref.id}:${ref.key ?? ""}:${ref.kind ?? ""}`, ref])).values()];
  if (!unique.length) return 0;
  const residual = unique.reduce((product, ref) => product * (1 - evidenceWeight(ref)), 1);
  return Number((1 - residual).toFixed(3));
}

function computeGoalConfidence(refs?: Array<string | DigestEvidenceRef> | null) {
  if (!Array.isArray(refs) || refs.length === 0) return undefined;
  return scoreEvidenceConfidence(refs.map((ref) => normalizeEvidenceRef(ref)));
}

function buildConfidenceList(
  provenanceEntries?: Array<{ value?: string; refs?: Array<string | DigestEvidenceRef> }> | null,
  fallbackEntries?: Array<{ value?: string; score?: number }> | null
) {
  const provenance = normalizeValueProvenanceList(provenanceEntries);
  if (provenance.length) {
    return provenance.map((entry) => ({
      value: entry.value,
      score: scoreEvidenceConfidence(entry.refs)
    }));
  }
  return normalizeConfidenceList(fallbackEntries);
}

function sameDedupeGroup(a: MemoryEvent, b: MemoryEvent) {
  return a.type === b.type && (a.key ?? "") === (b.key ?? "");
}

function extractKind(content: string): MemoryEventKind {
  const text = content.toLowerCase();
  if (/\b(decide|decision|we will|agreed|approved)\b/.test(text)) return "decision";
  if (/\b(constraint|blocked|limitation|cannot|must not)\b/.test(text)) return "constraint";
  if (/\b(todo|next step|action item|follow up|follow-up)\b/.test(text)) return "todo";
  if (/\b(question|\?)\b/.test(text)) return "question";
  if (/\b(progress|status|done|shipped|completed|finished)\b/.test(text)) return "status";
  if (text.length < 8 || /^(ok|thanks|noted|lol)$/.test(text.trim())) return "noise";
  return "note";
}

function importanceForKind(kind: MemoryEventKind, content: string) {
  const keywordBoost = /\b(decide|decision|constraint|blocked|todo|next)\b/i.test(content) ? 0.15 : 0;
  const base: Record<MemoryEventKind, number> = {
    decision: 0.85,
    constraint: 0.8,
    todo: 0.7,
    status: 0.55,
    question: 0.5,
    note: 0.45,
    noise: 0.05
  };
  return Math.min(1, base[kind] + keywordBoost);
}

function makeFeatures(event: MemoryEvent): EventFeatures {
  const kind = extractKind(event.content);
  return {
    kind,
    importanceScore: importanceForKind(kind, event.content),
    noveltyScore: 0,
    docKey: event.key ?? undefined
  };
}

function dedupeConsecutiveEvents(events: MemoryEvent[], rationale: string[]) {
  const output: MemoryEvent[] = [];
  let prev: MemoryEvent | null = null;
  for (const event of events) {
    if (prev && sameDedupeGroup(prev, event) && jaccardSimilarity(prev.content, event.content) >= 0.92) {
      rationale.push(`dedup:${event.id}`);
      continue;
    }
    output.push(event);
    prev = event;
  }
  return output;
}

function dedupeNearDuplicateEvents(events: MemoryEvent[], rationale: string[]) {
  const kept: MemoryEvent[] = [];
  for (const event of events) {
    const duplicate = kept.find(
      (existing) => sameDedupeGroup(existing, event) && jaccardSimilarity(existing.content, event.content) >= 0.92
    );
    if (duplicate) {
      rationale.push(`dedup_near:${event.id}`);
      continue;
    }
    kept.push(event);
  }
  return kept;
}

function latestDocumentsByKey(events: MemoryEvent[]) {
  const map = new Map<string, MemoryEvent>();
  for (const event of events) {
    if (event.type !== "document" || !event.key) continue;
    if (!map.has(event.key)) {
      map.set(event.key, event);
    }
  }
  return [...map.values()];
}

export function selectEventsForDigest(input: {
  lastDigest?: Digest | null;
  recentEvents: MemoryEvent[];
  eventBudgetTotal: number;
  eventBudgetDocs: number;
  eventBudgetStream: number;
}): SelectionResult {
  const rationale: string[] = [];
  const sorted = [...input.recentEvents].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  const dedupedConsecutive = dedupeConsecutiveEvents(sorted, rationale);
  const deduped = dedupeNearDuplicateEvents(dedupedConsecutive, rationale);

  const docs = latestDocumentsByKey(deduped)
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    .slice(0, input.eventBudgetDocs);

  const docsById = new Set(docs.map((doc) => doc.id));
  const newestTs = deduped[0]?.createdAt.getTime() ?? Date.now();
  const oldestTs = deduped[deduped.length - 1]?.createdAt.getTime() ?? newestTs;
  const timeRange = Math.max(1, newestTs - oldestTs);
  const streamCandidates = deduped
    .filter((event) => !docsById.has(event.id) && event.type === "stream")
    .map((event) => {
      const features = makeFeatures(event);
      const recency = (event.createdAt.getTime() - oldestTs) / timeRange;
      const keywordBoost = /\b(decide|decision|we will|constraint|blocked|todo|next|risk|goal)\b/i.test(event.content) ? 0.1 : 0;
      const score = features.importanceScore * 0.7 + recency * 0.3 + keywordBoost;
      return { event, features, score };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, input.eventBudgetStream);

  const docSelected = docs.map((event) => ({ event, features: makeFeatures(event), score: 1 }));
  const merged = [...docSelected, ...streamCandidates]
    .slice(0, input.eventBudgetTotal)
    .map(({ event, features }) => ({ event, features }));

  rationale.push(`selected_docs:${docSelected.length}`);
  rationale.push(`selected_stream:${Math.max(0, merged.length - docSelected.length)}`);
  if (input.lastDigest) {
    rationale.push("included_last_digest");
  }

  return {
    selectedEvents: merged,
    documents: docs,
    includeLastDigest: Boolean(input.lastDigest),
    rationale
  };
}

function noveltyAgainstDigest(content: string, lastDigestText: string) {
  const overlap = jaccardSimilarity(content, lastDigestText);
  return Math.max(0, 1 - overlap);
}

export function detectDeltas(input: {
  lastDigestText?: string;
  selectedEvents: SelectedEvent[];
  noveltyThreshold: number;
}): DeltaCandidate[] {
  const lastDigestText = input.lastDigestText ?? "";
  const deltas: DeltaCandidate[] = [];
  for (const selected of input.selectedEvents) {
    const novelty = noveltyAgainstDigest(selected.event.content, lastDigestText);
    selected.features.noveltyScore = novelty;
    const keep =
      selected.features.kind === "decision" ||
      selected.features.kind === "constraint" ||
      novelty >= input.noveltyThreshold;
    if (!keep) continue;
    deltas.push({
      eventId: selected.event.id,
      reason: selected.features.kind === "decision" || selected.features.kind === "constraint"
        ? "stable_fact_signal"
        : "novel_event",
      features: selected.features,
      event: selected.event
    });
  }
  return deltas;
}

function parseLinesWithPrefix(text: string, prefix: string) {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.toLowerCase().startsWith(prefix.toLowerCase()))
    .map((line) => line.slice(prefix.length).trim())
    .filter(Boolean);
}

function parseGoal(text: string) {
  const match = text.match(/\bgoal\s*:\s*([^\n.]+)/i);
  return match?.[1]?.trim();
}

function findBestSemanticMatch(values: string[], candidate: string, threshold = 0.8) {
  let best: { value: string; score: number } | null = null;
  for (const value of values) {
    const score = normalizeText(value) === normalizeText(candidate) ? 1 : jaccardSimilarity(value, candidate);
    if (!best || score > best.score) {
      best = { value, score };
    }
  }
  return best && best.score >= threshold ? best.value : null;
}

function stripDecisionRevocationPrefix(text: string) {
  return text
    .replace(/^\s*(revoke|undo|cancel decision|cancel|drop|remove)\s+/i, "")
    .trim();
}

function stripTodoRemovalPrefix(text: string) {
  return text
    .replace(/^\s*(done|completed|complete|cancel|remove|drop|close)\s+/i, "")
    .trim();
}

function upsertValueProvenance(
  entries: DigestStateValueProvenance[] | undefined,
  value: string,
  evidence: DigestEvidenceRef
) {
  const normalizedValue = normalizeText(value);
  const list = [...(entries ?? [])];
  const existing = list.find((entry) => normalizeText(entry.value) === normalizedValue);
  if (existing) {
    existing.refs = [...new Map([...existing.refs, evidence].map((ref) => [`${ref.sourceType}:${ref.id}:${ref.key ?? ""}:${ref.kind ?? ""}`, ref])).values()];
  } else {
    list.push({ value, refs: [evidence] });
  }
  return normalizeValueProvenanceList(list);
}

function setGoalProvenance(refs: DigestEvidenceRef[] | undefined, evidence: DigestEvidenceRef) {
  return [...new Map([...(refs ?? []), evidence].map((ref) => [`${ref.sourceType}:${ref.id}:${ref.key ?? ""}:${ref.kind ?? ""}`, ref])).values()];
}

function replaceGoalProvenance(evidence: DigestEvidenceRef) {
  return [evidence];
}

function removeValueProvenance(
  entries: DigestStateValueProvenance[] | undefined,
  value: string
) {
  const normalizedValue = normalizeText(value);
  return normalizeValueProvenanceList((entries ?? []).filter((entry) => normalizeText(entry.value) !== normalizedValue));
}

function pushRecentChange(next: DigestState, change: DigestStateChange) {
  next.recentChanges = [...(next.recentChanges ?? []), change].slice(-25);
}

function mergeGoalUpdate(next: DigestState, goal: string, evidence: DigestEvidenceRef) {
  const previousGoal = next.stableFacts.goal?.trim();
  if (!previousGoal) {
    next.stableFacts.goal = goal;
    next.provenance!.goal = replaceGoalProvenance(evidence);
    pushRecentChange(next, { field: "goal", action: "set", value: goal, evidence });
    return;
  }

  const sameGoal =
    normalizeText(previousGoal) === normalizeText(goal) ||
    jaccardSimilarity(previousGoal, goal) >= 0.8;

  if (sameGoal) {
    next.provenance!.goal = setGoalProvenance(next.provenance?.goal, evidence);
    pushRecentChange(next, { field: "goal", action: "reaffirm", value: previousGoal, evidence });
    return;
  }

  pushRecentChange(next, { field: "goal", action: "remove", value: previousGoal, evidence });
  next.stableFacts.goal = goal;
  next.provenance!.goal = replaceGoalProvenance(evidence);
  pushRecentChange(next, { field: "goal", action: "set", value: goal, evidence });
}

function valuesBackedOnlyByDocumentKey(
  entries: DigestStateValueProvenance[] | undefined,
  documentKey: string
) {
  return (entries ?? [])
    .filter((entry) =>
      entry.refs.length > 0 &&
      entry.refs.every((ref) => ref.sourceType === "document" && ref.key === documentKey)
    )
    .map((entry) => entry.value);
}

function mergeDocumentBackedList(input: {
  currentValues: string[];
  currentProvenance: DigestStateValueProvenance[] | undefined;
  incomingValues: string[];
  evidence: DigestEvidenceRef;
  field: "constraints" | "decisions" | "todos";
  documentKey?: string;
  next: DigestState;
}) {
  const incoming = [...new Map(input.incomingValues.map((value) => [normalizeText(value), value])).values()];
  const existingByNormalized = new Map(input.currentValues.map((value) => [normalizeText(value), value]));

  if (input.documentKey) {
    const removableValues = valuesBackedOnlyByDocumentKey(input.currentProvenance, input.documentKey);
    for (const value of removableValues) {
      if (!incoming.some((candidate) => normalizeText(candidate) === normalizeText(value))) {
        input.currentValues.splice(input.currentValues.findIndex((item) => normalizeText(item) === normalizeText(value)), 1);
        input.currentProvenance = removeValueProvenance(input.currentProvenance, value);
        pushRecentChange(input.next, { field: input.field, action: "remove", value, evidence: input.evidence });
      }
    }
  }

  for (const value of incoming) {
    const existing = existingByNormalized.get(normalizeText(value)) ?? findBestSemanticMatch(input.currentValues, value);
    if (!existing) {
      input.currentValues.push(value);
      pushRecentChange(input.next, { field: input.field, action: "add", value, evidence: input.evidence });
      input.currentProvenance = upsertValueProvenance(input.currentProvenance, value, input.evidence);
      continue;
    }

    const sameValue = normalizeText(existing) === normalizeText(value) || jaccardSimilarity(existing, value) >= 0.8;
    if (sameValue) {
      input.currentProvenance = upsertValueProvenance(input.currentProvenance, existing, input.evidence);
      pushRecentChange(input.next, { field: input.field, action: "reaffirm", value: existing, evidence: input.evidence });
    }
  }

  return {
    values: [...new Set(input.currentValues)],
    provenance: input.currentProvenance
  };
}

export function protectedStateMerge(input: {
  prevState?: DigestState | null;
  deltaCandidates: DeltaCandidate[];
  documents: MemoryEvent[];
}): DigestState {
  const next = normalizeDigestState(input.prevState ?? DEFAULT_DIGEST_STATE);
  next.stableFacts.decisions = next.stableFacts.decisions ?? [];
  next.stableFacts.constraints = next.stableFacts.constraints ?? [];
  next.todos = next.todos ?? [];
  next.volatileContext = next.volatileContext ?? [];
  next.evidenceRefs = next.evidenceRefs ?? [];
  next.provenance = next.provenance ?? {};
  next.recentChanges = next.recentChanges ?? [];

  const docText = input.documents.map((doc) => doc.content).join("\n");
  const docGoal = parseGoal(docText);
  if (docGoal) {
    const evidence = input.documents[input.documents.length - 1]
      ? {
          id: input.documents[input.documents.length - 1].id,
          sourceType: "document" as const,
          key: input.documents[input.documents.length - 1].key ?? undefined
        }
      : null;
    if (evidence) {
      mergeGoalUpdate(next, docGoal, evidence);
    }
  }

  for (const doc of input.documents) {
    const docConstraints = parseLinesWithPrefix(doc.content, "constraint:");
    if (!docConstraints.length) continue;
    const mergedConstraints = mergeDocumentBackedList({
      currentValues: [...(next.stableFacts.constraints ?? [])],
      currentProvenance: next.provenance.constraints,
      incomingValues: docConstraints,
      evidence: { id: doc.id, sourceType: "document", key: doc.key ?? undefined },
      field: "constraints",
      documentKey: doc.key ?? undefined,
      next
    });
    next.stableFacts.constraints = mergedConstraints.values;
    next.provenance.constraints = mergedConstraints.provenance;
  }

  for (const doc of input.documents) {
    const docDecisions = parseLinesWithPrefix(doc.content, "decision:");
    if (!docDecisions.length) continue;
    const mergedDecisions = mergeDocumentBackedList({
      currentValues: [...(next.stableFacts.decisions ?? [])],
      currentProvenance: next.provenance.decisions,
      incomingValues: docDecisions,
      evidence: { id: doc.id, sourceType: "document", key: doc.key ?? undefined },
      field: "decisions",
      documentKey: doc.key ?? undefined,
      next
    });
    next.stableFacts.decisions = mergedDecisions.values;
    next.provenance.decisions = mergedDecisions.provenance;
  }

  for (const doc of input.documents) {
    const docTodos = parseLinesWithPrefix(doc.content, "todo:");
    if (!docTodos.length) continue;
    const mergedTodos = mergeDocumentBackedList({
      currentValues: [...(next.todos ?? [])],
      currentProvenance: next.provenance.todos,
      incomingValues: docTodos,
      evidence: { id: doc.id, sourceType: "document", key: doc.key ?? undefined },
      field: "todos",
      documentKey: doc.key ?? undefined,
      next
    });
    next.todos = mergedTodos.values;
    next.provenance.todos = mergedTodos.provenance;
  }

  for (const doc of input.documents) {
    next.evidenceRefs.push({
      id: doc.id,
      sourceType: "document",
      key: doc.key ?? undefined
    });
  }

  for (const delta of input.deltaCandidates) {
    const evidence = {
      id: delta.eventId,
      sourceType: "event" as const,
      kind: delta.features.kind
    };
    next.evidenceRefs.push(evidence);
    const text = delta.event.content.trim();
    const lowered = text.toLowerCase();

    if (delta.features.kind === "decision") {
      if (/\b(revoke|undo|cancel decision)\b/.test(lowered)) {
        const revokeTarget = stripDecisionRevocationPrefix(text);
        const matched = findBestSemanticMatch(next.stableFacts.decisions, revokeTarget, 0.45);
        if (matched) {
          next.stableFacts.decisions = next.stableFacts.decisions.filter((item) => item !== matched);
          next.provenance.decisions = removeValueProvenance(next.provenance.decisions, matched);
          pushRecentChange(next, { field: "decisions", action: "remove", value: matched, evidence });
        }
      } else {
        const existing = findBestSemanticMatch(next.stableFacts.decisions, text);
        if (!existing) {
          next.stableFacts.decisions.push(text);
          pushRecentChange(next, { field: "decisions", action: "add", value: text, evidence });
          next.provenance.decisions = upsertValueProvenance(next.provenance.decisions, text, evidence);
        } else {
          pushRecentChange(next, { field: "decisions", action: "reaffirm", value: existing, evidence });
          next.provenance.decisions = upsertValueProvenance(next.provenance.decisions, existing, evidence);
        }
      }

      const decisionGoal = parseGoal(text);
      if (decisionGoal) {
        mergeGoalUpdate(next, decisionGoal, evidence);
      }
    }

    if (delta.features.kind === "constraint" && delta.features.importanceScore >= 0.75) {
      const existing = findBestSemanticMatch(next.stableFacts.constraints, text);
      if (!existing) {
        next.stableFacts.constraints.push(text);
        pushRecentChange(next, { field: "constraints", action: "add", value: text, evidence });
        next.provenance.constraints = upsertValueProvenance(next.provenance.constraints, text, evidence);
      } else {
        pushRecentChange(next, { field: "constraints", action: "reaffirm", value: existing, evidence });
        next.provenance.constraints = upsertValueProvenance(next.provenance.constraints, existing, evidence);
      }
    }

    if (delta.features.kind === "todo") {
      if (/\b(done|completed|complete|cancel|remove|drop|close)\b/.test(lowered)) {
        const removalTarget = stripTodoRemovalPrefix(text);
        const matched = findBestSemanticMatch(next.todos, removalTarget, 0.45);
        if (matched) {
          next.todos = next.todos.filter((item) => item !== matched);
          next.provenance.todos = removeValueProvenance(next.provenance.todos, matched);
          pushRecentChange(next, { field: "todos", action: "remove", value: matched, evidence });
        }
      } else {
        const existing = findBestSemanticMatch(next.todos, text);
        if (!existing) {
          next.todos.push(text);
          pushRecentChange(next, { field: "todos", action: "add", value: text, evidence });
          next.provenance.todos = upsertValueProvenance(next.provenance.todos, text, evidence);
        } else {
          pushRecentChange(next, { field: "todos", action: "reaffirm", value: existing, evidence });
          next.provenance.todos = upsertValueProvenance(next.provenance.todos, existing, evidence);
        }
      }
    }

    if (delta.features.kind === "question") {
      const existing = findBestSemanticMatch(next.workingNotes.openQuestions ?? [], text, 0.7);
      if (!existing) {
        next.workingNotes.openQuestions = [...(next.workingNotes.openQuestions ?? []), text].slice(-10);
        next.provenance.openQuestions = upsertValueProvenance(next.provenance.openQuestions, text, evidence);
        pushRecentChange(next, { field: "openQuestions", action: "add", value: text, evidence });
      } else {
        next.provenance.openQuestions = upsertValueProvenance(next.provenance.openQuestions, existing, evidence);
        pushRecentChange(next, { field: "openQuestions", action: "reaffirm", value: existing, evidence });
      }
    }

    if (delta.features.kind === "status" || delta.features.kind === "note") {
      const existing = findBestSemanticMatch(next.volatileContext ?? [], text, 0.7);
      if (!existing) {
        next.volatileContext = [...(next.volatileContext ?? []), text].slice(-10);
        next.provenance.volatileContext = upsertValueProvenance(next.provenance.volatileContext, text, evidence);
        pushRecentChange(next, { field: "volatileContext", action: "add", value: text, evidence });
      } else {
        next.provenance.volatileContext = upsertValueProvenance(next.provenance.volatileContext, existing, evidence);
        pushRecentChange(next, { field: "volatileContext", action: "reaffirm", value: existing, evidence });
      }
    }

    if (/\b(risk|blocked|blocker)\b/.test(lowered)) {
      const existing = findBestSemanticMatch(next.workingNotes.risks ?? [], text, 0.7);
      if (!existing) {
        next.workingNotes.risks = [...(next.workingNotes.risks ?? []), text].slice(-10);
        next.provenance.risks = upsertValueProvenance(next.provenance.risks, text, evidence);
        pushRecentChange(next, { field: "risks", action: "add", value: text, evidence });
      } else {
        next.provenance.risks = upsertValueProvenance(next.provenance.risks, existing, evidence);
        pushRecentChange(next, { field: "risks", action: "reaffirm", value: existing, evidence });
      }
    }
  }

  next.stableFacts.decisions = [...new Set(next.stableFacts.decisions)];
  next.stableFacts.constraints = [...new Set(next.stableFacts.constraints ?? [])];
  next.todos = [...new Set(next.todos)];
  next.volatileContext = [...new Set(next.volatileContext ?? [])].slice(-10);
  const normalized = normalizeDigestState(next);
  next.evidenceRefs = normalized.evidenceRefs;
  next.provenance = normalized.provenance;
  next.recentChanges = normalized.recentChanges;

  return next as DigestState;
}

const classifierSchema = z.array(z.object({
  id: z.string(),
  kind: z.enum(["decision", "constraint", "todo", "note", "status", "question", "noise"]),
  importanceScore: z.number().min(0).max(1)
}));

function renderTemplate(template: string, data: Record<string, string>) {
  let output = template;
  for (const [key, value] of Object.entries(data)) {
    output = output.replaceAll(`{{${key}}}`, value);
  }
  return output;
}

function parseJson<T>(raw: string): T | null {
  const match = raw.match(/[\[{][\s\S]*[\]}]/);
  if (!match) return null;
  try {
    return JSON.parse(match[0]) as T;
  } catch {
    return null;
  }
}

export async function classifyEventsWithLlm(input: {
  selectedEvents: SelectedEvent[];
  llm: { chat: (messages: { role: "system" | "user"; content: string }[]) => Promise<string> };
  systemPrompt: string;
  userPromptTemplate: string;
}) {
  const eventText = input.selectedEvents
    .map((item) => `${item.event.id}: ${item.event.content}`)
    .join("\n");

  const userPrompt = renderTemplate(input.userPromptTemplate, { events: eventText });
  const raw = await input.llm.chat([
    { role: "system", content: input.systemPrompt },
    { role: "user", content: userPrompt }
  ]);

  const parsed = parseJson<unknown>(raw);
  const validated = classifierSchema.safeParse(parsed);
  if (!validated.success) return;

  const byId = new Map(validated.data.map((item) => [item.id, item]));
  for (const item of input.selectedEvents) {
    const found = byId.get(item.event.id);
    if (!found) continue;
    item.features.kind = found.kind;
    item.features.importanceScore = found.importanceScore;
  }
}

function wordsCount(text: string) {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

function normalizeBullet(text: string) {
  return normalizeText(text.replace(/^-\s*/, ""));
}

function mentionsFactWithNegation(text: string, fact: string, negationPattern: RegExp) {
  const normalized = text.toLowerCase();
  const keyTokens = tokenize(fact).slice(0, 4);
  if (!keyTokens.length) return false;
  const mentionsFact = keyTokens.every((token) => normalized.includes(token));
  return mentionsFact && negationPattern.test(normalized);
}

function mentionsFact(text: string, fact: string, tokenCount = 3) {
  const normalized = text.toLowerCase();
  const keyTokens = tokenize(fact).slice(0, tokenCount);
  if (!keyTokens.length) return false;
  return keyTokens.every((token) => normalized.includes(token));
}

export function consistencyCheck(input: {
  output: DigestOutput;
  previousDigest?: Digest | null;
  protectedState: DigestState;
}): DigestConsistencyResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  const parsed = DigestOutputSchema.safeParse(input.output);
  if (!parsed.success) {
    errors.push("invalid_output_schema");
    return { ok: false, errors, warnings };
  }

  if (wordsCount(input.output.summary) > 120) {
    errors.push("summary_too_long");
  }

  if (input.output.changes.length > 3) {
    errors.push("too_many_changes");
  }

  if (input.output.nextSteps.length < 1 || input.output.nextSteps.length > 3) {
    errors.push("invalid_next_steps_count");
  }

  const stableGoal = input.protectedState.stableFacts.goal;
  const mentionedGoal = parseGoal(input.output.summary);
  if (stableGoal && mentionedGoal && normalizeText(stableGoal) !== normalizeText(mentionedGoal)) {
    errors.push("goal_contradiction");
  }

  const summaryLower = input.output.summary.toLowerCase();
  const combinedText = [
    input.output.summary,
    ...input.output.changes,
    ...input.output.nextSteps
  ].join("\n").toLowerCase();
  if (stableGoal && !mentionedGoal && !mentionsFact(combinedText, stableGoal, 3)) {
    warnings.push("goal_omission");
  }

  const stableConstraints = input.protectedState.stableFacts.constraints ?? [];
  if (
    stableConstraints.length > 0 &&
    stableConstraints.every((constraint) => !mentionsFact(combinedText, constraint, 2))
  ) {
    warnings.push("constraint_omission");
  }
  const stableDecisions = input.protectedState.stableFacts.decisions ?? [];
  if (
    stableDecisions.length > 0 &&
    stableDecisions.every((decision) => !mentionsFact(combinedText, decision, 2))
  ) {
    warnings.push("decision_omission");
  }
  const stableTodos = input.protectedState.todos ?? [];
  if (
    stableTodos.length > 0 &&
    stableTodos.every((todo) => !mentionsFact(combinedText, todo, 2))
  ) {
    warnings.push("todo_omission");
  }
  for (const constraint of stableConstraints) {
    const keyTokens = tokenize(constraint).slice(0, 3);
    if (!keyTokens.length) continue;
    const mentionsConstraint = keyTokens.every((token) => summaryLower.includes(token));
    if (/\\b(remove|drop|lift|no longer|ignore)\\b/.test(summaryLower) && mentionsConstraint) {
      errors.push("constraint_contradiction");
      break;
    }
  }

  const decisionNegation = /\b(revert|reverse|undo|cancel|drop|abandon|deprioritize|no longer|instead)\b/;
  for (const decision of stableDecisions) {
    if (mentionsFactWithNegation(combinedText, decision, decisionNegation)) {
      errors.push("decision_contradiction");
      break;
    }
  }

  const todoNegation = /\b(remove|delete|drop|cancel|skip|ignore|defer|deprioritize)\b/;
  for (const todo of stableTodos) {
    if (mentionsFactWithNegation(combinedText, todo, todoNegation)) {
      errors.push("todo_contradiction");
      break;
    }
  }

  if (input.previousDigest) {
    const prevChanges = new Set(input.previousDigest.changes.split("\n").map(normalizeBullet).filter(Boolean));
    const nextChanges = new Set(input.output.changes.map(normalizeBullet).filter(Boolean));
    const allRepeated = nextChanges.size > 0 && [...nextChanges].every((change) => prevChanges.has(change));
    if (allRepeated) {
      errors.push("changes_repeated_from_previous_digest");
    }
  }

  const actionable = /^(add|build|create|define|deliver|document|fix|measure|review|ship|test|update|write|implement|refactor)\b/i;
  const vague = /^(clarify|improve|consider|optimize|iterate)\b/i;
  for (const step of input.output.nextSteps) {
    const normalized = step.trim();
    if (vague.test(normalized) && tokenize(normalized).length < 4) {
      errors.push("vague_next_step");
      continue;
    }
    if (!actionable.test(normalized) && tokenize(normalized).length < 4) {
      warnings.push("weak_next_step");
    }
  }

  return { ok: errors.length === 0, errors, warnings };
}

function formatProtectedState(state: DigestState) {
  return JSON.stringify(state, null, 2);
}

function formatDeltaCandidates(candidates: DeltaCandidate[]) {
  return candidates
    .map((candidate) => `- [${candidate.features.kind}] ${candidate.event.content}`)
    .join("\n");
}

function formatDocuments(docs: MemoryEvent[]) {
  return docs.map((doc) => `- ${doc.key ?? doc.id}: ${doc.content}`).join("\n");
}

export async function generateDigestStage2(input: {
  scope: ProjectScope;
  lastDigest?: Digest | null;
  protectedState: DigestState;
  deltaCandidates: DeltaCandidate[];
  documents: MemoryEvent[];
  llm: { chat: (messages: { role: "system" | "user"; content: string }[]) => Promise<string> };
  systemPrompt: string;
  userPromptTemplate: string;
  maxRetries: number;
}): Promise<DigestOutput> {
  const lastDigestText = input.lastDigest
    ? `Summary: ${input.lastDigest.summary}\nChanges: ${input.lastDigest.changes}\nNext steps: ${input.lastDigest.nextSteps.join(", ")}`
    : "(none)";

  let fixInstruction = "";
  let lastErrors: string[] = [];

  for (let attempt = 0; attempt <= input.maxRetries; attempt += 1) {
    const userPrompt = renderTemplate(input.userPromptTemplate, {
      scopeName: input.scope.name,
      scopeGoal: input.scope.goal ?? "(none)",
      scopeStage: input.scope.stage,
      lastDigest: lastDigestText,
      protectedState: formatProtectedState(input.protectedState),
      deltaCandidates: formatDeltaCandidates(input.deltaCandidates) || "(none)",
      documents: formatDocuments(input.documents) || "(none)"
    });

    const raw = await input.llm.chat([
      { role: "system", content: input.systemPrompt },
      { role: "user", content: `${userPrompt}\n${fixInstruction}` }
    ]);

    const parsed = parseJson<DigestOutput>(raw);
    const validated = DigestOutputSchema.safeParse(parsed);
    if (!validated.success) {
      lastErrors = ["invalid_json_output"];
      fixInstruction = `Fix output. Previous errors: ${lastErrors.join(", ")}. Return strict JSON only.`;
      continue;
    }

    const normalized: DigestOutput = {
      summary: validated.data.summary.trim(),
      changes: validated.data.changes.map((c) => c.trim()).filter(Boolean).slice(0, 3),
      nextSteps: validated.data.nextSteps.map((n) => n.trim()).filter(Boolean).slice(0, 3)
    };

    const check = consistencyCheck({
      output: normalized,
      previousDigest: input.lastDigest,
      protectedState: input.protectedState
    });

    if (check.ok) return normalized;

    if (
      input.lastDigest &&
      check.errors.length === 1 &&
      check.errors[0] === "changes_repeated_from_previous_digest"
    ) {
      return {
        summary: input.lastDigest.summary,
        changes: [],
        nextSteps: input.lastDigest.nextSteps?.length
          ? input.lastDigest.nextSteps.slice(0, 3)
          : ["Review recent events for changes."]
      };
    }

    lastErrors = check.errors;
    fixInstruction = `Fix output. Previous errors: ${check.errors.join(", ")}. Ensure summary<=120 words, changes<=3, nextSteps actionable.`;
  }

  throw new Error(`digest_consistency_failed:${lastErrors.join("|")}`);
}

export async function runDigestControlPipeline(input: {
  scope: ProjectScope;
  lastDigest?: Digest | null;
  prevState?: DigestState | null;
  recentEvents: MemoryEvent[];
  llm: { chat: (messages: { role: "system" | "user"; content: string }[]) => Promise<string> };
  prompts: {
    digestStage2SystemPrompt: string;
    digestStage2UserPrompt: string;
    digestClassifySystemPrompt?: string;
    digestClassifyUserPrompt?: string;
  };
  config: DigestControlConfig;
}): Promise<{
  digest: DigestOutput;
  state: DigestState;
  selection: SelectionResult;
  deltas: DeltaCandidate[];
  metrics: Record<string, number>;
  consistency: DigestConsistencyResult;
}> {
  const metrics: Record<string, number> = {};

  const tSelect = Date.now();
  const selection = selectEventsForDigest({
    lastDigest: input.lastDigest,
    recentEvents: input.recentEvents,
    eventBudgetTotal: input.config.eventBudgetTotal,
    eventBudgetDocs: input.config.eventBudgetDocs,
    eventBudgetStream: input.config.eventBudgetStream
  });
  metrics.selectionMs = Date.now() - tSelect;

  if (input.config.useLlmClassifier && input.prompts.digestClassifySystemPrompt && input.prompts.digestClassifyUserPrompt) {
    const tClassify = Date.now();
    await classifyEventsWithLlm({
      selectedEvents: selection.selectedEvents,
      llm: input.llm,
      systemPrompt: input.prompts.digestClassifySystemPrompt,
      userPromptTemplate: input.prompts.digestClassifyUserPrompt
    });
    metrics.classificationMs = Date.now() - tClassify;
  }

  const tDelta = Date.now();
  const lastDigestText = input.lastDigest
    ? [input.lastDigest.summary, input.lastDigest.changes, input.lastDigest.nextSteps.join(" ")].join("\n")
    : undefined;
  const deltas = detectDeltas({
    lastDigestText,
    selectedEvents: selection.selectedEvents,
    noveltyThreshold: input.config.noveltyThreshold
  });
  metrics.deltaMs = Date.now() - tDelta;

  const tMerge = Date.now();
  const state = protectedStateMerge({
    prevState: input.prevState ?? deriveStateFromDigest(input.lastDigest),
    deltaCandidates: deltas,
    documents: selection.documents
  });
  metrics.mergeMs = Date.now() - tMerge;

  const tGenerate = Date.now();
  const digest = await generateDigestStage2({
    scope: input.scope,
    lastDigest: input.lastDigest,
    protectedState: state,
    deltaCandidates: deltas,
    documents: selection.documents,
    llm: input.llm,
    systemPrompt: input.prompts.digestStage2SystemPrompt,
    userPromptTemplate: input.prompts.digestStage2UserPrompt,
    maxRetries: input.config.maxRetries
  });
  metrics.generationMs = Date.now() - tGenerate;

  const consistency = consistencyCheck({
    output: digest,
    previousDigest: input.lastDigest,
    protectedState: state
  });

  return { digest, state, selection, deltas, metrics, consistency };
}
