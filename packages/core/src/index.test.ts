import { afterEach, describe, expect, it, vi } from "vitest";
import { createChatModelClient, LlmClient } from "./index";

describe("createChatModelClient", () => {
  it("returns null when config is missing", () => {
    expect(createChatModelClient(null)).toBeNull();
  });

  it("creates a client from provider config", () => {
    const client = createChatModelClient({
      provider: "openai-compatible",
      baseUrl: "http://localhost:11434/v1",
      model: "local-model",
      apiKey: ""
    });

    expect(client).toBeInstanceOf(LlmClient);
  });
});

describe("LlmClient", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("omits authorization header when api key is empty", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: "ok" } }] })
    });
    vi.stubGlobal("fetch", fetchMock);

    const client = new LlmClient({
      baseUrl: "http://localhost:11434/v1",
      model: "local-model",
      apiKey: ""
    });

    await client.chat([{ role: "user", content: "hello" }]);

    const request = fetchMock.mock.calls[0]?.[1];
    expect(request?.headers).toEqual({ "Content-Type": "application/json" });
  });

  it("includes authorization header when api key is provided", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: "ok" } }] })
    });
    vi.stubGlobal("fetch", fetchMock);

    const client = new LlmClient({
      baseUrl: "https://api.openai.com/v1",
      model: "gpt-4o-mini",
      apiKey: "secret"
    });

    await client.chat([{ role: "user", content: "hello" }]);

    const request = fetchMock.mock.calls[0]?.[1];
    expect(request?.headers).toEqual({
      "Content-Type": "application/json",
      Authorization: "Bearer secret"
    });
  });
});
