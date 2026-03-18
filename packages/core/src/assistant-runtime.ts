import { createHash } from "crypto";
import type { ChatModel } from "./model-provider";

export type MemorySource = "telegram" | "cli" | "api" | "sdk";

export interface Digest {
  id: string;
  scopeId: string;
  summary: string;
  changes: string;
  nextSteps: string[];
  rebuildGroupId?: string | null;
  createdAt: Date;
}

export interface RuntimeMemoryService {
  ingestEvent(input: {
    userId: string;
    scopeId: string;
    type: "stream" | "document";
    source: MemorySource;
    key?: string | null;
    content: string;
  }): Promise<unknown>;
}

export interface RuntimeRetrieveService {
  retrieve(scopeId: string, limit: number, query?: string): Promise<{
    digest: Digest | null;
    events: Array<{ id: string; content: string; createdAt: Date }>;
    retrieval?: {
      matches?: Array<{
        id: string;
        sourceType?: "stream" | "document";
        key?: string | null;
        heuristicScore?: number;
        recencyScore?: number;
        embeddingScore?: number;
        finalScore?: number;
        rankingReason?: string;
      }>;
    };
  }>;
}

export type MemoryWriteTier = "ephemeral" | "candidate" | "stable" | "documented";
export type RuntimePolicyProfile = "default" | "conservative" | "document-heavy";

export interface RuntimePolicyOverrides {
  recallLimit?: number;
  promoteLongFormToDocumented?: boolean;
  digestOnCandidate?: boolean;
}

export interface RuntimeTurnInput {
  message: string;
  source?: MemorySource;
  policyProfile?: RuntimePolicyProfile;
  policyOverrides?: RuntimePolicyOverrides;
  writeTier?: MemoryWriteTier;
  documentKey?: string;
  digestMode?: "auto" | "force" | "skip";
  metadata?: Record<string, unknown>;
}

export interface ResolvedRecall {
  digest: Digest | null;
  events: Array<{ id: string; content: string; createdAt: Date }>;
  retrieval?: {
    matches?: Array<{
      id: string;
      sourceType?: "stream" | "document";
      key?: string | null;
      heuristicScore?: number;
      recencyScore?: number;
      embeddingScore?: number;
      finalScore?: number;
      rankingReason?: string;
    }>;
  };
  stateRef?: string | null;
  stateSnapshot?: RuntimeStateSnapshot | null;
}

export interface RuntimeStateSnapshot {
  digestId: string | null;
  state?: {
    stableFacts?: {
      goal?: string;
      constraints?: string[];
      decisions?: string[];
    };
    todos?: string[];
    workingNotes?: {
      risks?: string[];
      openQuestions?: string[];
    };
    provenance?: {
      goal?: Array<{
        id?: string;
        sourceType?: "document" | "event";
        key?: string;
        kind?: "decision" | "constraint" | "todo" | "note" | "status" | "question" | "noise";
      }>;
      constraints?: Array<{ value?: string; refs?: Array<{ id?: string; sourceType?: "document" | "event"; key?: string; kind?: "decision" | "constraint" | "todo" | "note" | "status" | "question" | "noise" }> }>;
      decisions?: Array<{ value?: string; refs?: Array<{ id?: string; sourceType?: "document" | "event"; key?: string; kind?: "decision" | "constraint" | "todo" | "note" | "status" | "question" | "noise" }> }>;
      todos?: Array<{ value?: string; refs?: Array<{ id?: string; sourceType?: "document" | "event"; key?: string; kind?: "decision" | "constraint" | "todo" | "note" | "status" | "question" | "noise" }> }>;
    };
    recentChanges?: Array<{
      field?: "goal" | "constraints" | "decisions" | "todos" | "volatileContext" | "openQuestions" | "risks";
      action?: "set" | "add" | "remove" | "reaffirm";
      value?: string;
    }>;
  } | null;
}

export interface GroundingEvidence {
  digestIds: string[];
  eventIds: string[];
  stateRefs: string[];
  digestSummary?: string | null;
  eventSnippets?: Array<{
    id: string;
    createdAt: string;
    snippet: string;
    sourceType?: "stream" | "document";
    key?: string | null;
    rankingReason?: string;
    heuristicScore?: number;
    recencyScore?: number;
    embeddingScore?: number;
    finalScore?: number;
  }>;
  stateSummary?: string | null;
  stateDetails?: {
    digestId: string | null;
    goal?: string;
    constraints?: string[];
    todos?: string[];
    risks?: string[];
    provenanceFields?: string[];
    recentChanges?: Array<{
      field?: "goal" | "constraints" | "decisions" | "todos" | "volatileContext" | "openQuestions" | "risks";
      action?: "set" | "add" | "remove" | "reaffirm";
      value?: string;
    }>;
  } | null;
}

export interface GroundedAnswer {
  answer: string;
  writeTier: MemoryWriteTier;
  digestTriggered: boolean;
  notes?: string[];
  evidence: GroundingEvidence;
}

export interface MemoryWriteDecision {
  tier: MemoryWriteTier;
  reason?: string;
}

export interface MemoryWritePolicy {
  classifyTurn(input: RuntimeTurnInput): MemoryWriteTier | MemoryWriteDecision | Promise<MemoryWriteTier | MemoryWriteDecision>;
}

export interface RecallPolicy {
  resolve(input: {
    scopeId: string;
    message: string;
  }): Promise<ResolvedRecall>;
}

export interface DigestPolicy {
  shouldDigest(input: {
    turn: RuntimeTurnInput;
    writeTier: MemoryWriteTier;
    recall: ResolvedRecall;
  }): boolean | { shouldDigest: boolean; reason?: string } | Promise<boolean | { shouldDigest: boolean; reason?: string }>;
}

export interface DigestTrigger {
  requestDigest(scopeId: string): Promise<void>;
}

export interface AssistantSessionOptions {
  userId: string;
  scopeId: string;
  memoryService: RuntimeMemoryService;
  recallPolicy: RecallPolicy;
  llm: ChatModel;
  prompts: {
    system: string;
    user: string;
  };
  memoryWritePolicy?: MemoryWritePolicy;
  digestPolicy?: DigestPolicy;
  digestTrigger?: DigestTrigger;
  assistantReplySource?: MemorySource;
}

export function buildGroundingStateDetails(snapshot?: RuntimeStateSnapshot | null) {
  if (!snapshot?.digestId) return null;
  const provenance = snapshot.state?.provenance;
  const recentChanges = snapshot.state?.recentChanges ?? [];
  const provenanceFields = [
    Array.isArray(provenance?.goal) && provenance.goal.length ? "goal" : null,
    Array.isArray(provenance?.constraints) && provenance.constraints.length ? "constraints" : null,
    Array.isArray(provenance?.decisions) && provenance.decisions.length ? "decisions" : null,
    Array.isArray(provenance?.todos) && provenance.todos.length ? "todos" : null
  ].filter((value): value is string => Boolean(value));
  const transitionTaxonomy = Object.fromEntries(
    Object.entries(
      recentChanges.reduce<Record<string, number>>((acc, change) => {
        if (!change?.field || !change?.action) return acc;
        const key = `${change.field}:${change.action}`;
        acc[key] = (acc[key] || 0) + 1;
        return acc;
      }, {})
    ).sort(([a], [b]) => a.localeCompare(b))
  );

  return {
    digestId: snapshot.digestId,
    goal: snapshot.state?.stableFacts?.goal,
    constraints: snapshot.state?.stableFacts?.constraints ?? [],
    todos: snapshot.state?.todos ?? [],
    risks: snapshot.state?.workingNotes?.risks ?? [],
    provenanceFields,
    transitionTaxonomy,
    recentChanges
  };
}

export function summarizeGroundingStateSnapshot(snapshot?: RuntimeStateSnapshot | null) {
  if (!snapshot?.digestId) return null;
  const goal = snapshot.state?.stableFacts?.goal;
  const constraints = snapshot.state?.stableFacts?.constraints ?? [];
  const todos = snapshot.state?.todos ?? [];
  const risks = snapshot.state?.workingNotes?.risks ?? [];
  const provenance = snapshot.state?.provenance;
  const recentChanges = snapshot.state?.recentChanges ?? [];
  const parts = [`digest:${snapshot.digestId}`];
  if (goal) parts.push(`goal:${goal}`);
  if (constraints.length) parts.push(`constraints:${constraints.slice(0, 2).join(" | ")}`);
  if (todos.length) parts.push(`todos:${todos.slice(0, 2).join(" | ")}`);
  if (risks.length) parts.push(`risks:${risks.slice(0, 2).join(" | ")}`);
  const provenanceParts = [
    Array.isArray(provenance?.goal) && provenance.goal.length ? "goal" : null,
    Array.isArray(provenance?.constraints) && provenance.constraints.length ? "constraints" : null,
    Array.isArray(provenance?.decisions) && provenance.decisions.length ? "decisions" : null,
    Array.isArray(provenance?.todos) && provenance.todos.length ? "todos" : null
  ].filter(Boolean);
  if (provenanceParts.length) {
    parts.push(`provenance:${provenanceParts.join("|")}`);
  }
  if (recentChanges.length) {
    parts.push(
      `recent:${recentChanges
        .slice(-2)
        .map((change) => `${change.field}:${change.action}:${change.value}`)
        .join(" | ")}`
    );
  }
  return parts.join("; ");
}

export function buildGroundingEvidence(input: {
  digest?: Digest | null;
  events: Array<{ id: string; content: string; createdAt: Date }>;
  retrieval?: ResolvedRecall["retrieval"];
  stateRef?: string | null;
  stateSnapshot?: RuntimeStateSnapshot | null;
}): GroundingEvidence {
  const stateDetails = buildGroundingStateDetails(input.stateSnapshot);
  const stateSummary = summarizeGroundingStateSnapshot(input.stateSnapshot);
  const retrievalMatches = new Map(
    input.retrieval?.matches?.map((match) => [match.id, match]) ?? []
  );
  return {
    digestIds: input.digest ? [input.digest.id] : [],
    eventIds: input.events.map((event) => event.id),
    stateRefs: input.stateRef ? [input.stateRef] : [],
    digestSummary: input.digest?.summary ?? null,
    eventSnippets: input.events.slice(0, 5).map((event) => {
      const match = retrievalMatches.get(event.id);
      return {
        id: event.id,
        createdAt: event.createdAt.toISOString(),
        snippet: event.content.length > 160 ? `${event.content.slice(0, 157)}...` : event.content,
        sourceType: match?.sourceType,
        key: match?.key ?? null,
        rankingReason: match?.rankingReason,
        heuristicScore: match?.heuristicScore,
        recencyScore: match?.recencyScore,
        embeddingScore: match?.embeddingScore,
        finalScore: match?.finalScore
      };
    }),
    stateSummary,
    stateDetails
  };
}

function shouldPromoteLongForm(text: string, overrides?: RuntimePolicyOverrides) {
  return overrides?.promoteLongFormToDocumented === true && (text.includes("\n") || text.length > 280);
}

export class DefaultMemoryWritePolicy implements MemoryWritePolicy {
  classifyTurn(input: RuntimeTurnInput): MemoryWriteDecision {
    if (input.writeTier) return { tier: input.writeTier, reason: "explicit_write_tier" };
    const text = input.message.trim().toLowerCase();
    if (!text) return { tier: "ephemeral", reason: "empty_message" };
    if (/^(thanks|thank you|ok|okay|cool|got it|sounds good)[.!]?$/i.test(text)) {
      return { tier: "ephemeral", reason: "acknowledgement_only" };
    }
    if (/^(goal|constraint|decision|todo)\s*:/i.test(text)) {
      return { tier: "stable", reason: "explicit_structured_memory" };
    }
    if (/\b(uploaded doc|document update|spec|architecture|roadmap)\b/i.test(text)) {
      return { tier: "documented", reason: "document_like_update" };
    }
    if (/\b(decide|decision|constraint|must|cannot|todo|next step|action item|blocked|risk)\b/i.test(text)) {
      return { tier: "stable", reason: "stable_fact_signal" };
    }
    return { tier: "candidate", reason: "default_candidate_memory" };
  }
}

export class ProfiledMemoryWritePolicy implements MemoryWritePolicy {
  constructor(private profile: RuntimePolicyProfile = "default") {}

  classifyTurn(input: RuntimeTurnInput): MemoryWriteDecision {
    if (input.writeTier) return { tier: input.writeTier, reason: "explicit_write_tier" };

    const text = input.message.trim().toLowerCase();
    if (!text) return { tier: "ephemeral", reason: "empty_message" };
    if (/^(thanks|thank you|ok|okay|cool|got it|sounds good)[.!]?$/i.test(text)) {
      return { tier: "ephemeral", reason: "acknowledgement_only" };
    }
    if (/^(goal|constraint|decision|todo)\s*:/i.test(text)) {
      return { tier: "stable", reason: `profile_${this.profile}_explicit_structured_memory` };
    }
    if (shouldPromoteLongForm(input.message, input.policyOverrides)) {
      return { tier: "documented", reason: "override_promote_long_form" };
    }

    if (this.profile === "conservative") {
      if (/\b(uploaded doc|document update|spec|architecture|roadmap)\b/i.test(text)) {
        return { tier: "documented", reason: "profile_conservative_document_like_update" };
      }
      if (/\b(decide|decision|constraint|must|cannot|todo|next step|action item|blocked|risk)\b/i.test(text)) {
        return { tier: "candidate", reason: "profile_conservative_requires_explicit_promotion" };
      }
      return { tier: "ephemeral", reason: "profile_conservative_default_ephemeral" };
    }

    if (this.profile === "document-heavy") {
      if (/\b(uploaded doc|document update|spec|architecture|roadmap)\b/i.test(text) || text.includes("\n") || text.length > 280) {
        return { tier: "documented", reason: "profile_document_heavy_long_form_memory" };
      }
      if (/\b(decide|decision|constraint|must|cannot|todo|next step|action item|blocked|risk)\b/i.test(text)) {
        return { tier: "stable", reason: "profile_document_heavy_stable_fact_signal" };
      }
      return { tier: "candidate", reason: "profile_document_heavy_default_candidate" };
    }

    return new DefaultMemoryWritePolicy().classifyTurn(input);
  }
}

export class DefaultRecallPolicy implements RecallPolicy {
  constructor(
    private retrieveService: RuntimeRetrieveService,
    private options?: {
      scopeStateLoader?: (scopeId: string) => Promise<RuntimeStateSnapshot | null>;
      limit?: number;
    }
  ) {}

  async resolve(input: { scopeId: string; message: string }): Promise<ResolvedRecall> {
    const result = await this.retrieveService.retrieve(input.scopeId, this.options?.limit ?? 12, input.message);
    const state = this.options?.scopeStateLoader ? await this.options.scopeStateLoader(input.scopeId) : null;
    return {
      digest: result.digest,
      events: result.events,
      retrieval: result.retrieval,
      stateRef: state?.digestId ?? null,
      stateSnapshot: state
    };
  }
}

export class ThresholdDigestPolicy implements DigestPolicy {
  constructor(private threshold = 1) {}

  async shouldDigest(input: { writeTier: MemoryWriteTier }): Promise<{ shouldDigest: boolean; reason?: string }> {
    if (this.threshold <= 1) {
      return {
        shouldDigest: input.writeTier === "stable" || input.writeTier === "documented",
        reason: input.writeTier === "stable" || input.writeTier === "documented"
          ? "stable_or_documented_turn"
          : "write_tier_below_threshold"
      };
    }
    return {
      shouldDigest: input.writeTier === "documented",
      reason: input.writeTier === "documented"
        ? "documented_turn"
        : "threshold_requires_documented_turn"
    };
  }
}

export class ProfiledDigestPolicy implements DigestPolicy {
  constructor(private profile: RuntimePolicyProfile = "default") {}

  async shouldDigest(input: { turn: RuntimeTurnInput; writeTier: MemoryWriteTier }): Promise<{ shouldDigest: boolean; reason?: string }> {
    if (input.turn.policyOverrides?.digestOnCandidate && input.writeTier === "candidate") {
      return {
        shouldDigest: true,
        reason: "override_digest_on_candidate"
      };
    }
    if (this.profile === "conservative") {
      return {
        shouldDigest: input.writeTier === "documented",
        reason: input.writeTier === "documented"
          ? "profile_conservative_documented_turn"
          : "profile_conservative_skip_non_documented"
      };
    }
    if (this.profile === "document-heavy") {
      return {
        shouldDigest: input.writeTier === "stable" || input.writeTier === "documented" || input.writeTier === "candidate",
        reason: input.writeTier === "ephemeral"
          ? "profile_document_heavy_skip_ephemeral"
          : "profile_document_heavy_digest_memory_turn"
      };
    }
    return new ThresholdDigestPolicy().shouldDigest(input);
  }
}

export function createRuntimePolicyBundle(profile: RuntimePolicyProfile = "default") {
  return {
    memoryWritePolicy: new ProfiledMemoryWritePolicy(profile),
    digestPolicy: new ProfiledDigestPolicy(profile)
  };
}

export function createRuntimeRecallPolicy(
  retrieveService: RuntimeRetrieveService,
  options?: {
    profile?: RuntimePolicyProfile;
    overrides?: RuntimePolicyOverrides;
    scopeStateLoader?: (scopeId: string) => Promise<RuntimeStateSnapshot | null>;
  }
) {
  const profile = options?.profile ?? "default";
  const profileLimit = profile === "conservative" ? 8 : profile === "document-heavy" ? 16 : 12;
  return new DefaultRecallPolicy(retrieveService, {
    scopeStateLoader: options?.scopeStateLoader,
    limit: options?.overrides?.recallLimit ?? profileLimit
  });
}

export class AssistantSession {
  private memoryWritePolicy: MemoryWritePolicy;
  private digestPolicy: DigestPolicy | null;

  constructor(private options: AssistantSessionOptions) {
    this.memoryWritePolicy = options.memoryWritePolicy ?? new DefaultMemoryWritePolicy();
    this.digestPolicy = options.digestPolicy ?? null;
  }

  async handleTurn(input: RuntimeTurnInput): Promise<GroundedAnswer> {
    const writeDecision = this.normalizeWriteDecision(await this.memoryWritePolicy.classifyTurn(input));
    const writeTier = writeDecision.tier;
    const notes = writeDecision.reason ? [`write_tier:${writeDecision.reason}`] : [];

    if (writeTier !== "ephemeral") {
      await this.writeTurn(input, writeTier);
    }

    const recall = await this.options.recallPolicy.resolve({
      scopeId: this.options.scopeId,
      message: input.message
    });

    const answer = await this.generateGroundedAnswer(input.message, recall);

    if (writeTier !== "ephemeral") {
      await this.options.memoryService.ingestEvent({
        userId: this.options.userId,
        scopeId: this.options.scopeId,
        type: "stream",
        source: this.options.assistantReplySource ?? "sdk",
        content: `Assistant reply: ${answer}`
      });
    }

    let digestTriggered = false;
    const shouldAttemptDigest = input.digestMode !== "skip" && Boolean(this.options.digestTrigger);
    if (shouldAttemptDigest) {
      if (input.digestMode === "force") {
        digestTriggered = true;
        notes.push("digest:forced_by_input");
      } else if (this.digestPolicy && this.options.digestTrigger) {
        const digestDecision = this.normalizeDigestDecision(await this.digestPolicy.shouldDigest({
          turn: input,
          writeTier,
          recall
        }));
        digestTriggered = digestDecision.shouldDigest;
        if (digestDecision.reason) {
          notes.push(`digest:${digestDecision.reason}`);
        }
      }
      if (digestTriggered && this.options.digestTrigger) {
        await this.options.digestTrigger.requestDigest(this.options.scopeId);
      }
    } else if (input.digestMode === "skip") {
      notes.push("digest:skipped_by_input");
    }

    return {
      answer,
      writeTier,
      digestTriggered,
      notes,
      evidence: this.buildEvidence(recall)
    };
  }

  private async writeTurn(input: RuntimeTurnInput, writeTier: MemoryWriteTier) {
    if (writeTier === "documented") {
      const explicitKey = input.documentKey ?? (typeof input.metadata?.documentKey === "string" ? input.metadata.documentKey : null);
      await this.options.memoryService.ingestEvent({
        userId: this.options.userId,
        scopeId: this.options.scopeId,
        type: "document",
        source: input.source ?? "sdk",
        key: explicitKey ?? this.deriveDocumentKey(input.message),
        content: input.message
      });
      return;
    }

    await this.options.memoryService.ingestEvent({
      userId: this.options.userId,
      scopeId: this.options.scopeId,
      type: "stream",
      source: input.source ?? "sdk",
      content: input.message
    });
  }

  private deriveDocumentKey(message: string) {
    return `runtime:${createHash("sha1").update(message).digest("hex").slice(0, 12)}`;
  }

  private normalizeWriteDecision(decision: MemoryWriteTier | MemoryWriteDecision): MemoryWriteDecision {
    if (typeof decision === "string") {
      return { tier: decision };
    }
    return decision;
  }

  private normalizeDigestDecision(
    decision: boolean | { shouldDigest: boolean; reason?: string }
  ): { shouldDigest: boolean; reason?: string } {
    if (typeof decision === "boolean") {
      return { shouldDigest: decision };
    }
    return decision;
  }

  private buildEvidence(recall: ResolvedRecall): GroundingEvidence {
    return buildGroundingEvidence(recall);
  }

  private async generateGroundedAnswer(question: string, recall: ResolvedRecall) {
    const userPrompt = this.options.prompts.user
      .replaceAll("{{question}}", question)
      .replaceAll("{{digest}}", recall.digest?.summary ?? "(none)")
      .replaceAll(
        "{{events}}",
        recall.events.map((event) => `- ${event.createdAt.toISOString()}: ${event.content}`).join("\n") || "(no events)"
      );

    return this.options.llm.chat([
      { role: "system", content: this.options.prompts.system },
      { role: "user", content: userPrompt }
    ]);
  }
}
