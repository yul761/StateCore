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
  evidence: {
    digestIds: string[];
    eventIds: string[];
    stateRefs: string[];
  };
}

export interface MemoryWritePolicy {
  classifyTurn(input: RuntimeTurnInput): MemoryWriteTier | Promise<MemoryWriteTier>;
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
  }): boolean | Promise<boolean>;
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
  classifyTurn(input: RuntimeTurnInput): MemoryWriteTier {
    if (input.writeTier) return input.writeTier;
    const text = input.message.trim().toLowerCase();
    if (!text) return "ephemeral";
    if (/^(thanks|thank you|ok|okay|cool|got it|sounds good)[.!]?$/i.test(text)) return "ephemeral";
    if (/^(goal|constraint|decision|todo)\s*:/i.test(text)) return "stable";
    if (/\b(uploaded doc|document update|spec|architecture|roadmap)\b/i.test(text)) return "documented";
    if (/\b(decide|decision|constraint|must|cannot|todo|next step|action item|blocked|risk)\b/i.test(text)) {
      return "stable";
    }
    return "candidate";
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

  async shouldDigest(input: { writeTier: MemoryWriteTier }): Promise<boolean> {
    if (this.threshold <= 1) {
      return input.writeTier === "stable" || input.writeTier === "documented";
    }
    return input.writeTier === "documented";
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
    const writeTier = await this.memoryWritePolicy.classifyTurn(input);

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
      } else if (this.digestPolicy && this.options.digestTrigger) {
        digestTriggered = await this.digestPolicy.shouldDigest({
          turn: input,
          writeTier,
          recall
        });
      }
      if (digestTriggered && this.options.digestTrigger) {
        await this.options.digestTrigger.requestDigest(this.options.scopeId);
      }
    }

    return {
      answer,
      writeTier,
      digestTriggered,
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
