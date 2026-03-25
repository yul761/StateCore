import { Controller, Get } from "@nestjs/common";
import { apiEnv } from "./env";

@Controller()
export class HealthController {
  @Get("/health")
  getHealth() {
    return {
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
        structuredOutputModel: apiEnv.structuredOutputModelName,
        embeddingModel: apiEnv.embeddingModelName || null
      }
    };
  }
}
