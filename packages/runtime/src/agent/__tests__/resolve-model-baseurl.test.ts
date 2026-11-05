import { chat } from "@tanstack/ai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resolveModel } from "../model";

/**
 * The requests a resolved model string sends. The network is the only mock:
 * `fetch` records each request and answers 400, so the run ends after one
 * request with no retry.
 */
async function sentRequests(spec: string) {
  const adapter = await resolveModel(spec);
  const sent: Array<{ url: string; authorization: string | null }> = [];
  vi.stubGlobal(
    "fetch",
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init);
      sent.push({
        url: request.url,
        authorization: request.headers.get("authorization"),
      });
      return new Response(JSON.stringify({ error: { message: "stop" } }), {
        status: 400,
        headers: { "content-type": "application/json" },
      });
    },
  );
  const stream = chat({
    adapter,
    threadId: "thread-1",
    messages: [{ role: "user", content: "hi" }],
    stream: true,
    debug: false,
  });
  for await (const _chunk of stream) {
    // Drain the stream; the request is what this records.
  }
  return sent;
}

async function requestedUrls(spec: string) {
  const sent = await sentRequests(spec);
  return sent.map(({ url }) => url);
}

describe("resolveModel: endpoints from env", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    process.env.OPENAI_API_KEY = "test-openai-key";
    process.env.ANTHROPIC_API_KEY = "test-anthropic-key";
    process.env.GOOGLE_API_KEY = "test-google-key";
    process.env.MINIMAX_API_KEY = "test-minimax-key";
    delete process.env.OPENAI_BASE_URL;
    delete process.env.COPILOTKIT_OPENAI_API;
    delete process.env.ANTHROPIC_BASE_URL;
    delete process.env.GOOGLE_GENERATIVE_AI_BASE_URL;
    delete process.env.MINIMAX_BASE_URL;
    vi.spyOn(console, "info").mockImplementation(() => {});
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it.each([
    // OpenAI-compatible hosts get Chat Completions.
    [
      "https://openrouter.ai/api/v1",
      "https://openrouter.ai/api/v1/chat/completions",
    ],
    // OpenAI's own host keeps the Responses API.
    ["https://api.openai.com/v1", "https://api.openai.com/v1/responses"],
  ])("with OPENAI_BASE_URL=%s posts to %s", async (baseURL, expectedUrl) => {
    process.env.OPENAI_BASE_URL = baseURL;
    expect(await requestedUrls("openai/gpt-5")).toEqual([expectedUrl]);
  });

  it("uses api.openai.com when OPENAI_BASE_URL is unset", async () => {
    expect(await requestedUrls("openai/gpt-5")).toEqual([
      "https://api.openai.com/v1/responses",
    ]);
  });

  it("COPILOTKIT_OPENAI_API=responses posts to /responses on a proxy", async () => {
    process.env.OPENAI_BASE_URL = "https://my-gateway.example.com/v1";
    process.env.COPILOTKIT_OPENAI_API = "responses";
    expect(await requestedUrls("openai/gpt-5")).toEqual([
      "https://my-gateway.example.com/v1/responses",
    ]);
  });

  it.each([
    ["https://anthropic.internal/v1", "https://anthropic.internal/v1/messages"],
    [
      "https://anthropic.internal/v1/",
      "https://anthropic.internal/v1/messages",
    ],
    [undefined, "https://api.anthropic.com/v1/messages"],
  ])("with ANTHROPIC_BASE_URL=%s posts to %s", async (baseURL, expectedUrl) => {
    if (baseURL !== undefined) process.env.ANTHROPIC_BASE_URL = baseURL;
    const [url] = await requestedUrls("anthropic/claude-sonnet-4.5");
    // The adapter adds `?beta=true`; the endpoint is the part before it.
    expect(url?.split("?")[0]).toBe(expectedUrl);
  });

  it.each([
    [
      "https://google.internal/v1beta",
      "https://google.internal/v1beta/models/gemini-2.5-pro:streamGenerateContent?alt=sse",
    ],
    [
      undefined,
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro:streamGenerateContent?alt=sse",
    ],
  ])(
    "with GOOGLE_GENERATIVE_AI_BASE_URL=%s posts to %s",
    async (baseURL, expectedUrl) => {
      if (baseURL !== undefined) {
        process.env.GOOGLE_GENERATIVE_AI_BASE_URL = baseURL;
      }
      expect(await requestedUrls("google/gemini-2.5-pro")).toEqual([
        expectedUrl,
      ]);
    },
  );

  it.each(["MiniMax-M3", "MiniMax-M2.7"])(
    "posts MiniMax model %s to the global endpoint",
    async (modelId) => {
      expect(await requestedUrls(`minimax/${modelId}`)).toEqual([
        "https://api.minimax.io/v1/chat/completions",
      ]);
    },
  );

  it("sends MINIMAX_API_KEY, not OPENAI_API_KEY, to MiniMax", async () => {
    const [request] = await sentRequests("minimax/MiniMax-M3");
    expect(request?.authorization).toBe("Bearer test-minimax-key");
  });

  it("posts MiniMax models to MINIMAX_BASE_URL", async () => {
    process.env.MINIMAX_BASE_URL = "https://api.minimaxi.com/v1";
    expect(await requestedUrls("minimax:MiniMax-M3")).toEqual([
      "https://api.minimaxi.com/v1/chat/completions",
    ]);
  });
});
