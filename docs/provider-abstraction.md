# Provider Abstraction Specification

This document defines the intended model-provider abstraction for Project Memory.

Project Memory should support local models, remote models, and OpenAI-compatible endpoints without turning into a model hosting platform. The project owns the memory runtime, not the model lifecycle.

## Purpose

The provider abstraction exists to decouple memory logic from any single model vendor or environment variable scheme.

Its goals are:

- support bring-your-own-model usage
- make local and self-hosted setups practical
- avoid hard-coding OpenAI-specific assumptions into the runtime
- keep model integration secondary to the memory system

## Current State in the Repository

Today the repository is effectively OpenAI-compatible but still OpenAI-named.

Current configuration uses:

- `FEATURE_LLM`
- `OPENAI_API_KEY`
- `OPENAI_BASE_URL`
- `OPENAI_MODEL`

This works for OpenAI and many OpenAI-compatible local endpoints, but it has two problems:

1. it makes the codebase look more provider-specific than it really is
2. it weakens the project's BYOM and self-hosted positioning

The current code paths that depend on this setup include:

- `apps/api/src/env.ts`
- `apps/worker/src/env.ts`
- `apps/api/src/memory.controller.ts`
- `apps/worker/src/main.ts`
- `packages/core/src/index.ts`

## Design Principle

Provider abstraction should make model choice a configuration concern, not a memory architecture concern.

Project Memory should continue to own:

- event ingestion
- digest control
- protected state
- retrieval
- answer grounding
- replay and evaluation

Project Memory should not take ownership of:

- model downloads
- model serving infrastructure
- GPU orchestration
- provider account lifecycle

## Product Positioning Rule

The provider layer is important, but it is not the product center.

Provider support should be judged by one question:

Does this make the memory runtime easier to use with local or self-hosted models without distracting from low-drift memory?

If not, it is not a near-term priority.

## Target Configuration Model

The project should evolve toward neutral provider configuration names.

Recommended environment variables:

- `MODEL_PROVIDER`
- `MODEL_BASE_URL`
- `MODEL_NAME`
- `MODEL_API_KEY`

Optional future variables:

- `MODEL_TEMPERATURE`
- `MODEL_TIMEOUT_MS`
- `EMBEDDING_PROVIDER`
- `EMBEDDING_BASE_URL`
- `EMBEDDING_MODEL`
- `EMBEDDING_API_KEY`

This keeps the current chat and digest use cases compatible with future embedding or structured-output model separation.

## Recommended Provider Modes

### OpenAI-compatible First

The first and most practical abstraction target is OpenAI-compatible APIs.

That includes:

- OpenAI
- Ollama adapters that expose OpenAI-compatible endpoints
- LM Studio
- other local OpenAI-compatible gateways

This is the right first step because it gives broad compatibility with low implementation complexity.

### Provider-specific Adapters Later

Direct provider adapters should only be added when they clearly improve:

- local model usability
- memory evaluation comparability
- reliability of structured outputs

They should not be added just to expand the provider matrix.

## Runtime Abstraction Boundaries

The runtime should eventually separate three model roles:

- `ChatModel`
- `StructuredOutputModel`
- `EmbeddingModel`

This matters because digest generation, grounded answering, and retrieval embeddings may not share the same optimal model.

In the near term, one provider client may back more than one role, but the interfaces should still be designed as separate concerns.

## Provider Factory

The repository now includes an initial provider bundle in `packages/core/src/model-provider.ts`, and should continue evolving it instead of falling back to ad hoc client construction.

Current behavior:

- API requests a provider bundle and uses its `chat` role
- worker requests a provider bundle and uses its `structuredOutput` role
- embedding is not implemented yet and still resolves to `null`

Target behavior:

- API requests a provider client from a factory
- worker requests a provider client from a factory
- provider-specific configuration stays centralized

Conceptually:

```ts
interface ModelProviderFactory {
  createChatModel(): ChatModel;
  createStructuredOutputModel(): StructuredOutputModel;
  createEmbeddingModel?(): EmbeddingModel;
}
```

This is no longer purely aspirational. The current repository already exposes a provider bundle with `chat`, `structuredOutput`, and `embedding` roles, but only the first two are backed by a real client today.

## Compatibility Rule

The provider abstraction should preserve current OpenAI-compatible behavior while making naming and construction more neutral.

Recommended migration rule:

- keep `OPENAI_*` as legacy-compatible aliases for a transition period
- prefer `MODEL_*` in new docs and new code
- emit clear errors when required values are missing

That avoids a breaking change while improving the architecture.

## Local Model Support

Local model support should be practical, not ceremonial.

The near-term goal is not "support every local runtime". The near-term goal is:

- a developer can point Project Memory at a local OpenAI-compatible endpoint
- the memory runtime works without code changes
- evaluation and replay workflows still behave consistently

That is enough to satisfy the self-hosted and BYOM promise in a pragmatic way.

## Configuration Semantics

### `MODEL_PROVIDER`

Identifies the provider mode or adapter type.

Examples:

- `openai-compatible`
- `openai`
- `ollama`
- `lmstudio`

The value should influence client construction and error messages, not core memory logic.

### `MODEL_BASE_URL`

The base HTTP endpoint for model requests.

This should support both remote and local endpoints.

### `MODEL_NAME`

The model identifier used for chat or structured output requests.

### `MODEL_CHAT_NAME`

Optional override for chat and runtime-answer workloads. If omitted, the system falls back to `MODEL_NAME`.

### `MODEL_CHAT_BASE_URL`

Optional override for the chat/runtime endpoint. If omitted, the system falls back to `MODEL_BASE_URL`.

### `MODEL_CHAT_API_KEY`

Optional override for the chat/runtime credential. If omitted, the system falls back to `MODEL_API_KEY`.

### `MODEL_STRUCTURED_OUTPUT_NAME`

Optional override for digest and other structured-output style workloads. If omitted, the system falls back to `MODEL_NAME`.

### `MODEL_STRUCTURED_OUTPUT_BASE_URL`

Optional override for the structured-output endpoint. If omitted, the system falls back to `MODEL_BASE_URL`.

### `MODEL_STRUCTURED_OUTPUT_API_KEY`

Optional override for the structured-output credential. If omitted, the system falls back to `MODEL_API_KEY`.

### `MODEL_API_KEY`

The credential used for providers that require bearer auth.

For local setups that do not require auth, this may be optional depending on provider mode.

## Error and Validation Rules

Configuration validation should be explicit.

Examples:

- If `FEATURE_LLM=true` but no provider configuration is valid, startup should fail clearly.
- If a provider mode requires auth, the API key should be validated at startup.
- If a local provider mode does not require auth, the error messaging should not pretend that an OpenAI key is mandatory.

This is important because current error messages still imply that all LLM usage requires `OPENAI_API_KEY`.

## Relationship to Evaluation

Provider abstraction is not only a DX improvement. It also supports research quality.

It enables:

- cross-model drift comparison
- provider-specific latency and consistency comparison
- reproducible reporting of model settings
- cleaner separation between memory quality and provider behavior

Evaluation reports should continue to record:

- provider type
- model name
- base URL or serving mode
- temperature and timeout settings if applicable

## Relationship to Assistant Runtime

The assistant runtime should depend on abstract model roles, not on provider-specific clients.

That means:

- `AssistantSession` should not know about OpenAI env vars
- write policy and recall policy should remain provider-agnostic
- answer grounding should remain provider-agnostic

Only the model factory boundary should care about how a provider client is created.

## Non-goals

The provider abstraction should not expand into:

- model download management
- built-in model serving
- hardware scheduling
- benchmark marketing focused on raw model performance
- large provider-specific feature matrices

Those directions dilute the memory-first product line.

## Recommended Migration Path

The safest migration path is:

1. define neutral configuration names in docs
2. add support for `MODEL_*` aliases alongside `OPENAI_*`
3. centralize provider construction behind a factory
4. update API and worker to use the factory
5. update docs and examples to prefer provider-neutral configuration
6. later de-emphasize `OPENAI_*` without breaking existing setups

## Suggested Interfaces

The provider abstraction can evolve toward boundaries like:

```ts
interface ChatModel {
  chat(messages: { role: "system" | "user"; content: string }[]): Promise<string>;
}

interface StructuredOutputModel {
  chat(messages: { role: "system" | "user"; content: string }[]): Promise<string>;
}

interface EmbeddingModel {
  embed(inputs: string[]): Promise<number[][]>;
}
```

These boundaries match the roadmap better than a single catch-all client.

## Documentation Implications

The docs should gradually shift from:

- "set `OPENAI_API_KEY`"

to:

- "set `FEATURE_LLM=true` and configure a compatible provider"

The first supported path can still be OpenAI-compatible, but the wording should match the BYOM product direction.

## Success Criteria

The provider abstraction is successful when:

- a developer can use Project Memory with a local or remote compatible model endpoint
- core memory logic does not change across providers
- configuration names communicate neutrality rather than vendor lock-in
- evaluation reports can compare memory behavior across providers

At that point, model support becomes a clean extension point instead of an accidental product identity.
