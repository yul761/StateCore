import { BadRequestException, Body, Controller, Get, Inject, Post, Query, Req } from "@nestjs/common";
import { randomUUID } from "crypto";
import {
  AnswerInput,
  DigestRebuildInput,
  DigestRequestInput,
  MemoryEventInput,
  RuntimeTurnInput,
  RetrieveInput
} from "@project-memory/contracts";
import {
  AssistantSession,
  type ChatModel,
  createRuntimePolicyBundle,
  createRuntimeRecallPolicy,
  createModelProvider,
  generateAnswer
} from "@project-memory/core";
import { digestQueue } from "./queue";
import { DomainService } from "./domain.service";
import type { RequestWithUser } from "./types";
import { apiEnv } from "./env";
import { answerSystemPrompt, answerUserPrompt } from "@project-memory/prompts";

@Controller()
export class MemoryController {
  private llm: ChatModel | null = null;

  constructor(@Inject(DomainService) private readonly domain: DomainService) {
    if (apiEnv.featureLlm) {
      this.llm = createModelProvider({
        provider: apiEnv.modelProvider,
        apiKey: apiEnv.modelApiKey,
        baseUrl: apiEnv.modelBaseUrl,
        model: apiEnv.modelName,
        chatApiKey: apiEnv.chatModelApiKey,
        chatBaseUrl: apiEnv.chatModelBaseUrl,
        chatModel: apiEnv.chatModelName,
        structuredOutputApiKey: apiEnv.structuredOutputModelApiKey,
        structuredOutputBaseUrl: apiEnv.structuredOutputModelBaseUrl,
        structuredOutputModel: apiEnv.structuredOutputModelName,
        embeddingApiKey: apiEnv.embeddingModelApiKey,
        embeddingBaseUrl: apiEnv.embeddingModelBaseUrl,
        embeddingModel: apiEnv.embeddingModelName || undefined,
        timeoutMs: 20000
      })?.chat ?? null;
    }
  }

  @Post("/memory/events")
  async ingestEvent(@Req() req: RequestWithUser, @Body() body: unknown) {
    const input = MemoryEventInput.parse(body);
    if (input.type === "document" && !input.key) {
      return { error: "key required for document events" };
    }
    const scope = await this.domain.projectService.getScope(req.userId, input.scopeId);
    if (!scope) {
      return { error: "Scope not found" };
    }
    const event = await this.domain.memoryService.ingestEvent({
      userId: req.userId,
      scopeId: input.scopeId,
      type: input.type,
      source: input.source ?? "api",
      key: input.key ?? null,
      content: input.content
    });
    return {
      id: event.id,
      userId: event.userId,
      scopeId: event.scopeId,
      type: event.type,
      source: event.source,
      key: event.key ?? null,
      content: event.content,
      createdAt: event.createdAt.toISOString(),
      updatedAt: event.updatedAt ? event.updatedAt.toISOString() : null
    };
  }

  @Get("/memory/events")
  async listEvents(
    @Req() req: RequestWithUser,
    @Query("scopeId") scopeId?: string,
    @Query("limit") limit?: string,
    @Query("cursor") cursor?: string
  ) {
    if (!scopeId) return { error: "scopeId required" };
    const scope = await this.domain.projectService.getScope(req.userId, scopeId);
    if (!scope) {
      return { error: "Scope not found" };
    }
    const parsed = Number(limit ?? 20);
    const take = Math.min(Number.isFinite(parsed) ? parsed : 20, 100);
    const { items, nextCursor } = await this.domain.memoryService.listEvents(scopeId, take, cursor ?? null);
    return {
      items: items.map((event) => ({
        id: event.id,
        userId: event.userId,
        scopeId: event.scopeId,
        type: event.type,
        source: event.source,
        key: event.key ?? null,
        content: event.content,
        createdAt: event.createdAt.toISOString(),
        updatedAt: event.updatedAt ? event.updatedAt.toISOString() : null
      })),
      nextCursor
    };
  }

  @Post("/memory/digest")
  async enqueueDigest(@Req() req: RequestWithUser, @Body() body: unknown) {
    if (!apiEnv.featureLlm) {
      throw new BadRequestException("FEATURE_LLM disabled. Enable FEATURE_LLM=true and configure MODEL_* or OPENAI_* to run digest.");
    }
    const input = DigestRequestInput.parse(body);
    const scope = await this.domain.projectService.getScope(req.userId, input.scopeId);
    if (!scope) {
      return { error: "Scope not found" };
    }
    const job = await digestQueue.add("digest_scope", { userId: req.userId, scopeId: input.scopeId });
    return { jobId: job.id };
  }

  @Post("/memory/digest/rebuild")
  async rebuildDigest(@Req() req: RequestWithUser, @Body() body: unknown) {
    if (!apiEnv.featureLlm) {
      throw new BadRequestException("FEATURE_LLM disabled. Enable FEATURE_LLM=true and configure MODEL_* or OPENAI_* to run digest rebuild.");
    }
    const input = DigestRebuildInput.parse(body);
    const scope = await this.domain.projectService.getScope(req.userId, input.scopeId);
    if (!scope) {
      return { error: "Scope not found" };
    }
    const rebuildGroupId = randomUUID();
    const job = await digestQueue.add("rebuild_digest_chain", {
      userId: req.userId,
      scopeId: input.scopeId,
      from: input.from,
      to: input.to,
      strategy: input.strategy ?? "full",
      rebuildGroupId
    });
    return { jobId: job.id, rebuildGroupId };
  }

  @Get("/memory/digests")
  async listDigests(
    @Req() req: RequestWithUser,
    @Query("scopeId") scopeId?: string,
    @Query("limit") limit?: string,
    @Query("cursor") cursor?: string,
    @Query("rebuildGroupId") rebuildGroupId?: string
  ) {
    if (!scopeId) return { error: "scopeId required" };
    const scope = await this.domain.projectService.getScope(req.userId, scopeId);
    if (!scope) {
      return { error: "Scope not found" };
    }
    const parsed = Number(limit ?? 20);
    const take = Math.min(Number.isFinite(parsed) ? parsed : 20, 100);
    const { items, nextCursor } = rebuildGroupId
      ? await this.domain.listDigests(scopeId, take, cursor ?? null, rebuildGroupId)
      : await this.domain.digestService.listDigests(scopeId, take, cursor ?? null);
    return {
      items: items.map((digest) => ({
        id: digest.id,
        scopeId: digest.scopeId,
        summary: digest.summary,
        changes: digest.changes,
        nextSteps: digest.nextSteps,
        createdAt: digest.createdAt.toISOString(),
        rebuildGroupId: digest.rebuildGroupId ?? null
      })),
      nextCursor
    };
  }

  @Get("/memory/state")
  async getLatestDigestState(@Req() req: RequestWithUser, @Query("scopeId") scopeId?: string) {
    if (!scopeId) return { error: "scopeId required" };
    const scope = await this.domain.projectService.getScope(req.userId, scopeId);
    if (!scope) {
      return { error: "Scope not found" };
    }
    const snapshot = await this.domain.getLatestDigestState(scopeId);
    if (!snapshot) {
      return { digestId: null, state: null, consistency: null, createdAt: null };
    }
    return {
      digestId: snapshot.digestId,
      state: snapshot.state,
      consistency: snapshot.consistency,
      createdAt: snapshot.createdAt.toISOString()
    };
  }

  @Get("/memory/state/history")
  async getDigestStateHistory(
    @Req() req: RequestWithUser,
    @Query("scopeId") scopeId?: string,
    @Query("limit") limit?: string,
    @Query("rebuildGroupId") rebuildGroupId?: string
  ) {
    if (!scopeId) return { error: "scopeId required" };
    const scope = await this.domain.projectService.getScope(req.userId, scopeId);
    if (!scope) {
      return { error: "Scope not found" };
    }
    const parsed = Number(limit ?? 10);
    const take = Math.min(Number.isFinite(parsed) ? parsed : 10, 50);
    const items = await this.domain.listDigestStates(scopeId, take, rebuildGroupId ?? null);
    return {
      items: items.map((snapshot) => ({
        digestId: snapshot.digestId,
        state: snapshot.state,
        consistency: snapshot.consistency,
        createdAt: snapshot.createdAt.toISOString()
      }))
    };
  }

  @Post("/memory/retrieve")
  async retrieve(@Req() req: RequestWithUser, @Body() body: unknown) {
    const input = RetrieveInput.parse(body);
    const scope = await this.domain.projectService.getScope(req.userId, input.scopeId);
    if (!scope) {
      return { error: "Scope not found" };
    }
    const limit = input.limit ?? 20;
    const result = await this.domain.retrieveService.retrieve(input.scopeId, limit, input.query);
    return {
      digest: result.digest ? result.digest.summary : null,
      events: result.events.map((event) => ({
        id: event.id,
        content: event.content,
        createdAt: event.createdAt.toISOString()
      })),
      retrieval: result.retrieval
    };
  }

  @Post("/memory/answer")
  async answer(@Req() req: RequestWithUser, @Body() body: unknown) {
    if (!apiEnv.featureLlm || !this.llm) {
      throw new BadRequestException("FEATURE_LLM disabled");
    }
    const input = AnswerInput.parse(body);
    const scope = await this.domain.projectService.getScope(req.userId, input.scopeId);
    if (!scope) {
      return { error: "Scope not found" };
    }
    const result = await this.domain.retrieveService.retrieve(input.scopeId, 25, input.question);
    const snapshot = await this.domain.getLatestDigestState(input.scopeId);
    const digestText = result.digest ? result.digest.summary : null;
    const eventsText = result.events.map((event) => `- ${event.createdAt.toISOString()}: ${event.content}`).join("\n");

    const answer = await generateAnswer({
      question: input.question,
      digestText,
      eventsText,
      systemPrompt: answerSystemPrompt,
      userPromptTemplate: answerUserPrompt,
      llm: this.llm
    });

    const retrievalMatches = new Map((result.retrieval?.matches ?? []).map((match) => [match.id, match]));
    const provenance = snapshot?.state?.provenance;
    const provenanceFields = [
      Array.isArray(provenance?.goal) && provenance.goal.length ? "goal" : null,
      Array.isArray(provenance?.constraints) && provenance.constraints.length ? "constraints" : null,
      Array.isArray(provenance?.decisions) && provenance.decisions.length ? "decisions" : null,
      Array.isArray(provenance?.todos) && provenance.todos.length ? "todos" : null
    ].filter((value): value is string => Boolean(value));
    const stateDetails = snapshot?.digestId
      ? {
          digestId: snapshot.digestId,
          goal: snapshot.state?.stableFacts?.goal,
          constraints: snapshot.state?.stableFacts?.constraints ?? [],
          todos: snapshot.state?.todos ?? [],
          risks: snapshot.state?.workingNotes?.risks ?? [],
          provenanceFields,
          recentChanges: snapshot.state?.recentChanges ?? []
        }
      : null;
    const stateSummary = snapshot?.digestId
      ? [
          `digest:${snapshot.digestId}`,
          snapshot.state?.stableFacts?.goal ? `goal:${snapshot.state.stableFacts.goal}` : null,
          Array.isArray(snapshot.state?.stableFacts?.constraints) && snapshot.state.stableFacts.constraints.length
            ? `constraints:${snapshot.state.stableFacts.constraints.slice(0, 2).join(" | ")}`
            : null,
          Array.isArray(snapshot.state?.todos) && snapshot.state.todos.length
            ? `todos:${snapshot.state.todos.slice(0, 2).join(" | ")}`
            : null,
          provenanceFields.length ? `provenance:${provenanceFields.join("|")}` : null
        ].filter(Boolean).join("; ")
      : null;

    return {
      answer,
      evidence: {
        digestIds: result.digest ? [result.digest.id] : [],
        eventIds: result.events.map((event) => event.id),
        stateRefs: snapshot?.digestId ? [snapshot.digestId] : [],
        digestSummary: result.digest?.summary ?? null,
        eventSnippets: result.events.slice(0, 5).map((event) => {
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
      }
    };
  }

  @Post("/memory/runtime/turn")
  async runtimeTurn(@Req() req: RequestWithUser, @Body() body: unknown) {
    if (!apiEnv.featureLlm || !this.llm) {
      throw new BadRequestException("FEATURE_LLM disabled");
    }
    const input = RuntimeTurnInput.parse(body);
    const scope = await this.domain.projectService.getScope(req.userId, input.scopeId);
    if (!scope) {
      return { error: "Scope not found" };
    }

    const policyProfile = input.policyProfile ?? "default";
    const policies = createRuntimePolicyBundle(policyProfile);
    const session = new AssistantSession({
      userId: req.userId,
      scopeId: input.scopeId,
      memoryService: this.domain.memoryService,
      recallPolicy: createRuntimeRecallPolicy(this.domain.retrieveService, {
        profile: policyProfile,
        overrides: input.policyOverrides,
        scopeStateLoader: async (scopeId) => this.domain.getLatestDigestState(scopeId)
      }),
      llm: this.llm,
      prompts: {
        system: answerSystemPrompt,
        user: answerUserPrompt
      },
      memoryWritePolicy: policies.memoryWritePolicy,
      digestPolicy: policies.digestPolicy,
      digestTrigger: {
        requestDigest: async (scopeId) => {
          await digestQueue.add("digest_scope", { userId: req.userId, scopeId });
        }
      },
      assistantReplySource: "api"
    });

    return session.handleTurn({
      message: input.message,
      source: input.source ?? "api",
      policyProfile,
      policyOverrides: input.policyOverrides,
      writeTier: input.writeTier,
      documentKey: input.documentKey,
      digestMode: input.digestMode ?? "auto",
      metadata: input.metadata
    });
  }
}
