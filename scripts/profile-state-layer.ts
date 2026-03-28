import { prisma } from "@statecore/db";
import { createModelProvider, runDigestControlPipeline } from "@statecore/core";
import { digestClassifySystemPrompt, digestClassifyUserPrompt, digestStage2SystemPrompt, digestStage2UserPrompt } from "@statecore/prompts";
import { workerEnv } from "../apps/worker/src/env";
import { Queue } from "bullmq";

type Args = {
  scopeId?: string;
  userId?: string;
  queue?: boolean;
};

function parseArgs(argv: string[]): Args {
  const result: Args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--") {
      continue;
    }
    const next = argv[i + 1];
    if (arg === "--scope-id" && next) {
      result.scopeId = next;
      i += 1;
      continue;
    }
    if (arg === "--user-id" && next) {
      result.userId = next;
      i += 1;
      continue;
    }
    if (arg === "--queue") {
      result.queue = true;
    }
  }
  return result;
}

function toCoreDigest(digest: { id: string; scopeId: string; summary: string; changes: string; nextSteps: unknown; createdAt: Date; rebuildGroupId?: string | null }) {
  return {
    id: digest.id,
    scopeId: digest.scopeId,
    summary: digest.summary,
    changes: digest.changes,
    nextSteps: Array.isArray(digest.nextSteps) ? (digest.nextSteps as string[]) : [],
    createdAt: digest.createdAt,
    rebuildGroupId: digest.rebuildGroupId ?? null
  };
}

async function resolveScopeId(args: Args) {
  if (args.scopeId) {
    return args.scopeId;
  }

  const userId = args.userId || process.env.BENCH_USER_ID || process.env.STATECORE_CLI_USER_ID || "benchmark-user";
  const state = await prisma.userState.findUnique({ where: { userId } });
  if (state?.activeProjectId) {
    return state.activeProjectId;
  }

  const latestScope = await prisma.projectScope.findFirst({
    where: { userId },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }]
  });
  if (latestScope?.id) {
    return latestScope.id;
  }

  const globalLatestScope = await prisma.projectScope.findFirst({
    orderBy: [{ createdAt: "desc" }, { id: "desc" }]
  });
  return globalLatestScope?.id ?? null;
}

async function main() {
  if (!workerEnv.featureLlm) {
    throw new Error("FEATURE_LLM must be true");
  }

  const provider = createModelProvider({
    provider: workerEnv.modelProvider,
    apiKey: workerEnv.modelApiKey,
    baseUrl: workerEnv.modelBaseUrl,
    model: workerEnv.modelName,
    chatApiKey: workerEnv.chatModelApiKey,
    chatBaseUrl: workerEnv.chatModelBaseUrl,
    chatModel: workerEnv.chatModelName,
    structuredOutputApiKey: workerEnv.structuredOutputModelApiKey,
    structuredOutputBaseUrl: workerEnv.structuredOutputModelBaseUrl,
    structuredOutputModel: workerEnv.structuredOutputModelName,
    embeddingApiKey: workerEnv.embeddingModelApiKey,
    embeddingBaseUrl: workerEnv.embeddingModelBaseUrl,
    embeddingModel: workerEnv.embeddingModelName || undefined,
    timeoutMs: workerEnv.modelTimeoutMs
  });
  const llm = provider?.structuredOutput ?? null;
  if (!llm) {
    throw new Error("Structured-output model is not configured");
  }
  const digestLlm = {
    chat: async (messages: { role: "system" | "user"; content: string }[]) =>
      llm.chat(messages, {
        ...(typeof workerEnv.structuredOutputMaxOutputTokens === "number"
          ? { maxOutputTokens: workerEnv.structuredOutputMaxOutputTokens }
          : {}),
        ...(workerEnv.structuredOutputReasoningEffort
          ? { reasoningEffort: workerEnv.structuredOutputReasoningEffort }
          : {})
      })
  };
  const llmCalls: Array<{ index: number; tookMs: number }> = [];
  const instrumentedLlm = {
    chat: async (messages: { role: "system" | "user"; content: string }[]) => {
      const startedAt = Date.now();
      const response = await digestLlm.chat(messages);
      llmCalls.push({
        index: llmCalls.length + 1,
        tookMs: Date.now() - startedAt
      });
      return response;
    }
  };

  const args = parseArgs(process.argv.slice(2));
  const scopeId = await resolveScopeId(args);
  if (!scopeId) {
    throw new Error("Could not resolve scope. Pass --scope-id or --user-id.");
  }

  const totalStartedAt = Date.now();

  const scopeStartedAt = Date.now();
  const scope = await prisma.projectScope.findFirst({ where: { id: scopeId } });
  const scopeLookupMs = Date.now() - scopeStartedAt;
  if (!scope) {
    throw new Error(`Scope not found: ${scopeId}`);
  }

  const lastDigestStartedAt = Date.now();
  const lastDigestRow = await prisma.digest.findFirst({
    where: { scopeId },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }]
  });
  const lastDigestLookupMs = Date.now() - lastDigestStartedAt;

  const lastStateStartedAt = Date.now();
  const lastStateRow = await prisma.digestStateSnapshot.findFirst({
    where: { scopeId },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }]
  });
  const lastStateLookupMs = Date.now() - lastStateStartedAt;

  const since = new Date(Date.now() - workerEnv.maxDaysLookback * 24 * 60 * 60 * 1000);
  const eventsStartedAt = Date.now();
  const recentStreamEvents = await prisma.memoryEvent.findMany({
    where: { scopeId, createdAt: { gte: since }, type: "stream" },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    ...(lastDigestRow ? { take: workerEnv.maxRecentEvents } : {})
  });
  const recentDocumentEvents = await prisma.memoryEvent.findMany({
    where: { scopeId, createdAt: { gte: since }, type: "document" },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }]
  });
  const recentEvents = [...recentStreamEvents, ...recentDocumentEvents];
  const eventLoadMs = Date.now() - eventsStartedAt;

  if (args.queue) {
    const queue = new Queue("digest", { connection: { url: workerEnv.redisUrl } });
    const latestStableBefore = await prisma.digestStateSnapshot.findFirst({
      where: { scopeId },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }]
    });
    const job = await queue.add("digest_scope", {
      userId: scope.userId,
      scopeId
    });

    const startedAt = Date.now();
    let processedOn: number | null = null;
    let finishedOn: number | null = null;
    let stateDigestId: string | null = latestStableBefore?.digestId ?? null;

    while (Date.now() - startedAt <= 120_000) {
      const current = await queue.getJob(job.id as string);
      if (current?.processedOn) {
        processedOn = current.processedOn;
      }
      if (current?.finishedOn) {
        finishedOn = current.finishedOn;
        break;
      }
      if (await current?.isFailed()) {
        throw new Error(`Digest queue job failed: ${await current?.failedReason}`);
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }

    const latestStableAfter = await prisma.digestStateSnapshot.findFirst({
      where: { scopeId },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }]
    });
    stateDigestId = latestStableAfter?.digestId ?? stateDigestId;
    await queue.close();

    const output = {
      mode: "queue",
      scopeId,
      scopeName: scope.name,
      inspectedAt: new Date().toISOString(),
      latestEventCreatedAt: recentEvents[0]?.createdAt?.toISOString?.() ?? null,
      recentEventCount: recentEvents.length,
      jobId: String(job.id),
      queuedAt: new Date(job.timestamp).toISOString(),
      processedAt: processedOn ? new Date(processedOn).toISOString() : null,
      finishedAt: finishedOn ? new Date(finishedOn).toISOString() : null,
      latestStableDigestIdBefore: latestStableBefore?.digestId ?? null,
      latestStableDigestIdAfter: stateDigestId,
      timingsMs: {
        queueWaitMs: processedOn ? Math.max(0, processedOn - job.timestamp) : null,
        executionMs: processedOn && finishedOn ? Math.max(0, finishedOn - processedOn) : null,
        endToEndMs: finishedOn ? Math.max(0, finishedOn - job.timestamp) : null
      }
    };

    // eslint-disable-next-line no-console
    console.log(JSON.stringify(output, null, 2));
    return;
  }

  const pipelineStartedAt = Date.now();
  const result = await runDigestControlPipeline({
    scope,
    lastDigest: lastDigestRow ? toCoreDigest(lastDigestRow) : null,
    prevState: (lastStateRow?.state as any) ?? null,
    recentEvents,
    llm: instrumentedLlm,
    prompts: {
      digestStage2SystemPrompt,
      digestStage2UserPrompt,
      digestClassifySystemPrompt,
      digestClassifyUserPrompt
    },
    config: {
      eventBudgetTotal: workerEnv.digestEventBudgetTotal,
      eventBudgetDocs: workerEnv.digestEventBudgetDocs,
      eventBudgetStream: workerEnv.digestEventBudgetStream,
      noveltyThreshold: workerEnv.digestNoveltyThreshold,
      maxRetries: workerEnv.digestMaxRetries,
      useLlmClassifier: workerEnv.digestUseLlmClassifier,
      debug: workerEnv.digestDebug
    }
  });
  const pipelineWallMs = Date.now() - pipelineStartedAt;

  const output = {
    scopeId,
    scopeName: scope.name,
    scopeGoal: scope.goal ?? null,
    inspectedAt: new Date().toISOString(),
    lastDigestId: lastDigestRow?.id ?? null,
    lastDigestCreatedAt: lastDigestRow?.createdAt.toISOString() ?? null,
    lastStateDigestId: lastStateRow?.digestId ?? null,
    lastStateCreatedAt: lastStateRow?.createdAt.toISOString() ?? null,
    recentEventCount: recentEvents.length,
    recentStreamEventCount: recentStreamEvents.length,
    recentDocumentEventCount: recentDocumentEvents.length,
    latestEventCreatedAt: recentEvents[0]?.createdAt?.toISOString?.() ?? null,
    selectedEventCount: result.selection.selectedEvents.length,
    selectedDocumentCount: result.selection.documents.length,
    deltaCount: result.deltas.length,
    consistency: {
      ok: result.consistency.ok,
      errors: result.consistency.errors,
      warnings: result.consistency.warnings
    },
    timingsMs: {
      scopeLookupMs,
      lastDigestLookupMs,
      lastStateLookupMs,
      eventLoadMs,
      selectionMs: result.metrics.selectionMs ?? 0,
      classificationMs: result.metrics.classificationMs ?? 0,
      deltaMs: result.metrics.deltaMs ?? 0,
      mergeMs: result.metrics.mergeMs ?? 0,
      generationMs: result.metrics.generationMs ?? 0,
      pipelineWallMs,
      totalWallMs: Date.now() - totalStartedAt
    },
    modelSettings: {
      structuredOutputModel: workerEnv.structuredOutputModelName,
      structuredOutputReasoningEffort: workerEnv.structuredOutputReasoningEffort ?? null,
      structuredOutputMaxOutputTokens: workerEnv.structuredOutputMaxOutputTokens ?? null
    },
    llmCalls,
    digestPreview: result.digest,
    selectionRationale: result.selection.rationale,
    deltaReasons: result.deltas.map((delta) => ({
      eventId: delta.eventId,
      reason: delta.reason,
      kind: delta.kind,
      importanceScore: delta.importanceScore
    }))
  };

  // eslint-disable-next-line no-console
  console.log(JSON.stringify(output, null, 2));
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
