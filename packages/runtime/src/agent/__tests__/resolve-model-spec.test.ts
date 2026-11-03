import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resolveModel } from "../index";

/**
 * How `resolveModel` splits a model string into provider + model id, and which
 * OpenAI API it targets. Uses the real AI SDK providers: building a model makes
 * no network call, and `provider` / `modelId` are public on the result.
 */
describe("resolveModel — model string parsing and OpenAI API route", () => {
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
    process.env.GOOGLE_VERTEX_PROJECT = "test-project";
    process.env.GOOGLE_VERTEX_LOCATION = "us-central1";
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  /** The one method these tests drive on a built model. */
  type Generates = {
    doGenerate(options: { prompt: unknown[] }): Promise<unknown>;
  };

  function resolved(spec: string) {
    const model = resolveModel(spec) as { provider: string; modelId: string };
    return { provider: model.provider, modelId: model.modelId };
  }

  it.each([
    ["openai/gpt-5", "openai.responses", "gpt-5"],
    ["openai:gpt-5", "openai.responses", "gpt-5"],
    ["OpenAI/gpt-5", "openai.responses", "gpt-5"],
    ["  openai/gpt-5  ", "openai.responses", "gpt-5"],
    [
      "openai/ft:gpt-4o-mini:org::id",
      "openai.responses",
      "ft:gpt-4o-mini:org::id",
    ],
    [
      "openai:ft:gpt-4o-mini:org::id",
      "openai.responses",
      "ft:gpt-4o-mini:org::id",
    ],
    [
      "openai/meta-llama/llama-3.3-70b",
      "openai.responses",
      "meta-llama/llama-3.3-70b",
    ],
    ["anthropic/claude-sonnet-4.5", "anthropic.messages", "claude-sonnet-4.5"],
    ["anthropic:claude-sonnet-4.5", "anthropic.messages", "claude-sonnet-4.5"],
    ["google/gemini-3.8-flash", "google.generative-ai", "gemini-3.8-flash"],
    ["gemini/gemini-3.8-flash", "google.generative-ai", "gemini-3.8-flash"],
    [
      "google-gemini/gemini-3.8-flash",
      "google.generative-ai",
      "gemini-3.8-flash",
    ],
    ["minimax/MiniMax-M3", "minimax.responses", "MiniMax-M3"],
    ["minimax:MiniMax-M3", "minimax.responses", "MiniMax-M3"],
    ["vertex/gemini-2.5-pro", "google.vertex.chat", "gemini-2.5-pro"],
  ])("resolves %s the same way as before", (spec, provider, modelId) => {
    expect(resolved(spec)).toEqual({ provider, modelId });
  });

  it("keeps a slash inside the model id when the provider uses a colon", () => {
    expect(resolved("openai:meta-llama/llama-3.3-70b")).toEqual({
      provider: "openai.responses",
      modelId: "meta-llama/llama-3.3-70b",
    });
  });

  it.each(["", "openai", "openai/", "openai:", "/gpt-5", ":gpt-5"])(
    "rejects %j as an invalid model string",
    (spec) => {
      expect(() => resolveModel(spec)).toThrow("Invalid model string");
    },
  );

  it("rejects an unknown provider", () => {
    expect(() => resolveModel("unknown/model")).toThrow("Unknown provider");
  });

  it.each([
    // OpenAI's own hosts, in any spelling, keep the Responses API.
    ["https://api.openai.com/v1", "openai.responses"],
    ["https://API.OPENAI.COM/v1", "openai.responses"],
    ["https://api.openai.com:443/v1", "openai.responses"],
    ["https://eu.api.openai.com/v1", "openai.responses"],
    // Azure's v1 endpoint serves /responses, so it keeps it too.
    ["https://myres.openai.azure.com/openai/v1/", "openai.responses"],
    // A value `new URL` cannot parse keeps the default route.
    ["not a url", "openai.responses"],
    // Any other host gets Chat Completions.
    ["https://openrouter.ai/api/v1", "openai.chat"],
    ["http://localhost:11434/v1", "openai.chat"],
  ])("with OPENAI_BASE_URL=%s builds %s", (baseURL, provider) => {
    process.env.OPENAI_BASE_URL = baseURL;
    expect(resolved("openai/meta-llama/llama-3.3-70b")).toEqual({
      provider,
      modelId: "meta-llama/llama-3.3-70b",
    });
  });

  it.each([
    [
      "https://openrouter.ai/api/v1",
      "https://openrouter.ai/api/v1/chat/completions",
    ],
    ["https://api.openai.com/v1", "https://api.openai.com/v1/responses"],
  ])("with OPENAI_BASE_URL=%s posts to %s", async (baseURL, expectedUrl) => {
    process.env.OPENAI_BASE_URL = baseURL;
    const requested: string[] = [];
    vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
      requested.push(String(input instanceof Request ? input.url : input));
      throw new Error("stop after recording the request");
    });
    try {
      const model = resolveModel("openai/gpt-5") as unknown as Generates;
      await expect(
        model.doGenerate({
          prompt: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
        }),
      ).rejects.toThrow();
    } finally {
      vi.unstubAllGlobals();
    }
    expect(requested).toEqual([expectedUrl]);
  });

  it("keeps the Responses API when OPENAI_BASE_URL is unset", () => {
    expect(resolved("openai/gpt-5")).toEqual({
      provider: "openai.responses",
      modelId: "gpt-5",
    });
  });
  it.each([
    // A proxy in front of OpenAI keeps the Responses API.
    ["https://my-gateway.example.com/v1", "responses", "openai.responses"],
    ["https://openrouter.ai/api/v1", "responses", "openai.responses"],
    // An OpenAI host, or no base URL, can opt into Chat Completions.
    ["https://api.openai.com/v1", "chat", "openai.chat"],
    [undefined, "chat", "openai.chat"],
    // Case and padding do not matter.
    ["https://my-gateway.example.com/v1", "  Responses ", "openai.responses"],
    [undefined, "CHAT", "openai.chat"],
    // Blank means unset: the host rule decides.
    ["https://my-gateway.example.com/v1", "  ", "openai.chat"],
    ["https://api.openai.com/v1", "", "openai.responses"],
  ])(
    "with OPENAI_BASE_URL=%s and COPILOTKIT_OPENAI_API=%j builds %s",
    (baseURL, api, provider) => {
      if (baseURL !== undefined) process.env.OPENAI_BASE_URL = baseURL;
      process.env.COPILOTKIT_OPENAI_API = api;
      expect(resolved("openai/gpt-5")).toEqual({ provider, modelId: "gpt-5" });
    },
  );

  it("rejects an unknown COPILOTKIT_OPENAI_API value", () => {
    process.env.COPILOTKIT_OPENAI_API = "completions";
    expect(() => resolveModel("openai/gpt-5")).toThrow(
      'Invalid COPILOTKIT_OPENAI_API "completions". Use "responses" or "chat", or leave it unset.',
    );
  });

  it("COPILOTKIT_OPENAI_API=responses posts to /responses on a proxy", async () => {
    process.env.OPENAI_BASE_URL = "https://my-gateway.example.com/v1";
    process.env.COPILOTKIT_OPENAI_API = "responses";
    const requested: string[] = [];
    vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
      requested.push(String(input instanceof Request ? input.url : input));
      throw new Error("stop after recording the request");
    });
    try {
      const model = resolveModel("openai/gpt-5") as unknown as Generates;
      await expect(
        model.doGenerate({
          prompt: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
        }),
      ).rejects.toThrow();
    } finally {
      vi.unstubAllGlobals();
    }
    expect(requested).toEqual(["https://my-gateway.example.com/v1/responses"]);
  });

  describe("Chat Completions notice", () => {
    // The notice logs once per process, so each test loads a fresh module.
    async function freshResolveModel() {
      vi.resetModules();
      return (await import("../index")).resolveModel;
    }

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it("logs once when the host rule picks Chat Completions", async () => {
      const info = vi.spyOn(console, "info").mockImplementation(() => {});
      const resolve = await freshResolveModel();
      process.env.OPENAI_BASE_URL = "https://my-gateway.example.com/v1";

      resolve("openai/gpt-5");
      resolve("openai/gpt-5-mini");

      expect(info).toHaveBeenCalledTimes(1);
      expect(info.mock.calls[0]?.[0]).toContain(
        "set COPILOTKIT_OPENAI_API=responses",
      );
    });

    it.each([
      ["an OpenAI host", "https://api.openai.com/v1", undefined],
      ["no base URL", undefined, undefined],
      [
        "an explicit chat override",
        "https://my-gateway.example.com/v1",
        "chat",
      ],
      [
        "an explicit responses override",
        "https://my-gateway.example.com/v1",
        "responses",
      ],
    ])("does not log for %s", async (_label, baseURL, api) => {
      const info = vi.spyOn(console, "info").mockImplementation(() => {});
      const resolve = await freshResolveModel();
      if (baseURL !== undefined) process.env.OPENAI_BASE_URL = baseURL;
      if (api !== undefined) process.env.COPILOTKIT_OPENAI_API = api;

      resolve("openai/gpt-5");

      expect(info).not.toHaveBeenCalled();
    });
  });
});
