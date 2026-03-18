import { createHash } from "crypto";
import type { LlmClient } from "./model-provider";

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
  }>;
}

export type MemoryWriteTier = "ephemeral" | "candidate" | "stable" | "documented";

export interface RuntimeTurnInput {
  message: string;
  source?: MemorySource;
  writeTier?: MemoryWriteTier;
  documentKey?: string;
  digestMode?: "auto" | "force" | "skip";
  metadata?: Record<string, unknown>;
}

export interface ResolvedRecall {
  digest: Digest | null;
  events: Array<{ id: string; content: string; createdAt: Date }>;
  stateRef?: string | null;
}

export interface GroundedAnswer {
  answer: string;
  writeTier: MemoryWriteTier;
  digestTriggered: boolean;
  notes?: string[];
  evidence: {
    digestIds: string[];
    eventIds: string[];
    stateRefs: string[];
  };
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
  llm: LlmClient;
  prompts: {
    system: string;
    user: string;
  };
  memoryWritePolicy?: MemoryWritePolicy;
  digestPolicy?: DigestPolicy;
  digestTrigger?: DigestTrigger;
  assistantReplySource?: MemorySource;
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

export class DefaultRecallPolicy implements RecallPolicy {
  constructor(
    private retrieveService: RuntimeRetrieveService,
    private options?: {
      scopeStateLoader?: (scopeId: string) => Promise<{ digestId: string | null } | null>;
      limit?: number;
    }
  ) {}

  async resolve(input: { scopeId: string; message: string }): Promise<ResolvedRecall> {
    const result = await this.retrieveService.retrieve(input.scopeId, this.options?.limit ?? 12, input.message);
    const state = this.options?.scopeStateLoader ? await this.options.scopeStateLoader(input.scopeId) : null;
    return {
      digest: result.digest,
      events: result.events,
      stateRef: state?.digestId ?? null
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
      evidence: {
        digestIds: recall.digest ? [recall.digest.id] : [],
        eventIds: recall.events.map((event) => event.id),
        stateRefs: recall.stateRef ? [recall.stateRef] : []
      }
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
