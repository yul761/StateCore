import { Controller, Get } from "@nestjs/common";
import { HealthOutput } from "@project-memory/contracts";
import { apiEnv } from "./env";
import { parseOutput } from "./output";

@Controller()
export class HealthController {
  @Get("/health")
  getHealth() {
    return parseOutput(HealthOutput, {
      status: "ok",
      featureLlm: apiEnv.featureLlm,
      workingMemory: {
        enabled: apiEnv.workingMemoryEnabled,
        useLlm: apiEnv.workingMemoryUseLlm,
        maxRecentTurns: apiEnv.workingMemoryMaxRecentTurns,
        maxItemsPerField: apiEnv.workingMemoryMaxItemsPerField
      },
      retrieve: {
        useEmbeddings: apiEnv.retrieveUseEmbeddings,
        embeddingCandidateLimit: apiEnv.retrieveEmbeddingCandidateLimit
      },
      model: {
        provider: apiEnv.modelProvider,
        model: apiEnv.modelName,
        baseUrl: apiEnv.modelBaseUrl,
        chatModel: apiEnv.chatModelName,
        runtimeModel: apiEnv.runtimeModelName,
        runtimeModelBaseUrl: apiEnv.runtimeModelBaseUrl,
        runtimeReasoningEffort: apiEnv.runtimeModelReasoningEffort,
        runtimeMaxOutputTokens: apiEnv.runtimeModelMaxOutputTokens,
        structuredOutputModel: apiEnv.structuredOutputModelName,
        embeddingModel: apiEnv.embeddingModelName || null
      }
    });
  }
}
