export interface LlmClientOptions {
  apiKey?: string;
  baseUrl: string;
  model: string;
  timeoutMs?: number;
}

export interface ModelProviderConfig {
  provider?: string;
  apiKey?: string;
  baseUrl: string;
  model: string;
  timeoutMs?: number;
}

export class LlmClient {
  private apiKey: string;
  private baseUrl: string;
  private model: string;
  private timeoutMs: number;

  constructor(options: LlmClientOptions) {
    this.apiKey = options.apiKey ?? "";
    this.baseUrl = options.baseUrl.replace(/\/$/, "");
    this.model = options.model;
    this.timeoutMs = options.timeoutMs ?? 20000;
  }

  async chat(messages: { role: "system" | "user"; content: string }[]) {
    let lastError: unknown;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
      try {
        const headers: Record<string, string> = {
          "Content-Type": "application/json"
        };
        if (this.apiKey) {
          headers.Authorization = `Bearer ${this.apiKey}`;
        }
        const response = await fetch(`${this.baseUrl}/chat/completions`, {
          method: "POST",
          headers,
          body: JSON.stringify({
            model: this.model,
            messages
          }),
          signal: controller.signal
        });

        if (!response.ok) {
          const text = await response.text();
          throw new Error(`LLM error ${response.status}: ${text}`);
        }

        const data: any = await response.json();
        const content = data?.choices?.[0]?.message?.content;
        if (!content) {
          throw new Error("LLM response missing content");
        }
        return String(content);
      } catch (err) {
        lastError = err;
        await new Promise((resolve) => setTimeout(resolve, 300 * (attempt + 1)));
      } finally {
        clearTimeout(timeout);
      }
    }
    throw lastError ?? new Error("LLM call failed");
  }
}

export function createChatModelClient(config: ModelProviderConfig | null | undefined) {
  if (!config) return null;
  return new LlmClient({
    apiKey: config.apiKey,
    baseUrl: config.baseUrl,
    model: config.model,
    timeoutMs: config.timeoutMs
  });
}
