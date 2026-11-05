import { createOpenaiChat } from "@tanstack/ai-openai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isAISDKLanguageModel, resolveModel } from "../model";

/**
 * How `resolveModel` splits a model string into provider + model id, which
 * adapter it builds, and which OpenAI API it targets. Uses the real TanStack
 * adapters: building one makes no network call, and `name`, `api` and `model`
 * are public on the result.
 */

/** An AI SDK `LanguageModel` as `@ai-sdk/openai` builds it, reduced to its shape. */
const aiSdkModel = {
  specificationVersion: "v3",
  provider: "openai.responses",
  modelId: "gpt-5",
  supportedUrls: {},
  doGenerate: async () => ({}),
  doStream: async () => ({}),
};

async function resolved(spec: string) {
  const { name, api, model } = await resolveModel(spec);
  return { name, api, model };
}

describe("resolveModel: model string parsing and adapters", () => {
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
    vi.restoreAllMocks();
  });

  it.each([
    ["openai/gpt-5", "openai", "openai-responses", "gpt-5"],
    ["openai:gpt-5", "openai", "openai-responses", "gpt-5"],
    ["OpenAI/gpt-5", "openai", "openai-responses", "gpt-5"],
    ["  openai/gpt-5  ", "openai", "openai-responses", "gpt-5"],
    [
      "openai/ft:gpt-4o-mini:org::id",
      "openai",
      "openai-responses",
      "ft:gpt-4o-mini:org::id",
    ],
    [
      "openai:ft:gpt-4o-mini:org::id",
      "openai",
      "openai-responses",
      "ft:gpt-4o-mini:org::id",
    ],
    [
      "openai/meta-llama/llama-3.3-70b",
      "openai",
      "openai-responses",
      "meta-llama/llama-3.3-70b",
    ],
    [
      "anthropic/claude-sonnet-4.5",
      "anthropic",
      "anthropic-messages",
      "claude-sonnet-4.5",
    ],
    [
      "anthropic:claude-sonnet-4.5",
      "anthropic",
      "anthropic-messages",
      "claude-sonnet-4.5",
    ],
    [
      "google/gemini-3.8-flash",
      "gemini",
      "google-generative-ai",
      "gemini-3.8-flash",
    ],
    [
      "gemini/gemini-3.8-flash",
      "gemini",
      "google-generative-ai",
      "gemini-3.8-flash",
    ],
    [
      "google-gemini/gemini-3.8-flash",
      "gemini",
      "google-generative-ai",
      "gemini-3.8-flash",
    ],
    ["minimax/MiniMax-M3", "minimax", "openai-completions", "MiniMax-M3"],
    ["minimax:MiniMax-M2.7", "minimax", "openai-completions", "MiniMax-M2.7"],
    ["vertex/gemini-2.5-pro", "gemini", "google-vertex", "gemini-2.5-pro"],
  ])("resolves %s to the %s adapter (%s)", async (spec, name, api, model) => {
    expect(await resolved(spec)).toEqual({ name, api, model });
  });

  it("keeps a slash inside the model id when the provider uses a colon", async () => {
    expect(await resolved("openai:meta-llama/llama-3.3-70b")).toEqual({
      name: "openai",
      api: "openai-responses",
      model: "meta-llama/llama-3.3-70b",
    });
  });

  it.each(["", "openai", "openai/", "openai:", "/gpt-5", ":gpt-5"])(
    "rejects %j as an invalid model string",
    async (spec) => {
      await expect(resolveModel(spec)).rejects.toThrow("Invalid model string");
    },
  );

  it("rejects an unknown provider and lists the supported ones", async () => {
    await expect(resolveModel("unknown/model")).rejects.toThrow(
      'Unknown provider "unknown" in "unknown/model". Supported: openai, anthropic, google (gemini), minimax, vertex.',
    );
  });

  it("uses the apiKey argument when the env var is unset", async () => {
    delete process.env.ANTHROPIC_API_KEY;
    expect((await resolveModel("anthropic/claude-x", "sk-arg")).name).toBe(
      "anthropic",
    );
  });

  it("names the env var when no API key is set", async () => {
    delete process.env.ANTHROPIC_API_KEY;
    await expect(resolveModel("anthropic/claude-x")).rejects.toThrow(
      'Missing API key for "anthropic/claude-x". Pass apiKey, or set ANTHROPIC_API_KEY.',
    );
  });

  it("falls back to GOOGLE_GENERATIVE_AI_API_KEY for Gemini", async () => {
    delete process.env.GOOGLE_API_KEY;
    process.env.GOOGLE_GENERATIVE_AI_API_KEY = "test-google-ai-key";
    expect((await resolved("google/gemini-3.8-flash")).name).toBe("gemini");
  });

  describe("OpenAI API route", () => {
    it.each([
      // OpenAI's own hosts, in any spelling, keep the Responses API.
      ["https://api.openai.com/v1", "openai-responses"],
      ["https://API.OPENAI.COM/v1", "openai-responses"],
      ["https://api.openai.com:443/v1", "openai-responses"],
      ["https://eu.api.openai.com/v1", "openai-responses"],
      // Azure's v1 endpoint serves /responses, so it keeps it too.
      ["https://myres.openai.azure.com/openai/v1/", "openai-responses"],
      // A value `new URL` cannot parse keeps the default route.
      ["not a url", "openai-responses"],
      // Any other host gets Chat Completions.
      ["https://openrouter.ai/api/v1", "openai-completions"],
      ["http://localhost:11434/v1", "openai-completions"],
    ])("with OPENAI_BASE_URL=%s builds %s", async (baseURL, api) => {
      process.env.OPENAI_BASE_URL = baseURL;
      vi.spyOn(console, "info").mockImplementation(() => {});
      expect((await resolved("openai/meta-llama/llama-3.3-70b")).api).toBe(api);
    });

    it("keeps the Responses API when OPENAI_BASE_URL is unset", async () => {
      expect((await resolved("openai/gpt-5")).api).toBe("openai-responses");
    });

    it.each([
      // A proxy in front of OpenAI keeps the Responses API.
      ["https://my-gateway.example.com/v1", "responses", "openai-responses"],
      ["https://openrouter.ai/api/v1", "responses", "openai-responses"],
      // An OpenAI host, or no base URL, can opt into Chat Completions.
      ["https://api.openai.com/v1", "chat", "openai-completions"],
      [undefined, "chat", "openai-completions"],
      // Case and padding do not matter.
      ["https://my-gateway.example.com/v1", "  Responses ", "openai-responses"],
      [undefined, "CHAT", "openai-completions"],
      // Blank means unset: the host rule decides.
      ["https://my-gateway.example.com/v1", "  ", "openai-completions"],
      ["https://api.openai.com/v1", "", "openai-responses"],
    ])(
      "with OPENAI_BASE_URL=%s and COPILOTKIT_OPENAI_API=%j builds %s",
      async (baseURL, override, api) => {
        if (baseURL !== undefined) process.env.OPENAI_BASE_URL = baseURL;
        process.env.COPILOTKIT_OPENAI_API = override;
        vi.spyOn(console, "info").mockImplementation(() => {});
        expect((await resolved("openai/gpt-5")).api).toBe(api);
      },
    );

    it("rejects an unknown COPILOTKIT_OPENAI_API value", async () => {
      process.env.COPILOTKIT_OPENAI_API = "completions";
      await expect(resolveModel("openai/gpt-5")).rejects.toThrow(
        'Invalid COPILOTKIT_OPENAI_API "completions". Use "responses" or "chat", or leave it unset.',
      );
    });
  });

  describe("Chat Completions notice", () => {
    // The notice logs once per process. Only a fresh copy of the module
    // resets that flag, so each test loads one after `vi.resetModules()`.
    async function freshResolveModel() {
      vi.resetModules();
      return (await import("../model")).resolveModel;
    }

    it("logs once when the host rule picks Chat Completions", async () => {
      const info = vi.spyOn(console, "info").mockImplementation(() => {});
      const resolve = await freshResolveModel();
      process.env.OPENAI_BASE_URL = "https://my-gateway.example.com/v1";

      await resolve("openai/gpt-5");
      await resolve("openai/gpt-5-mini");

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
    ])("does not log for %s", async (_label, baseURL, override) => {
      const info = vi.spyOn(console, "info").mockImplementation(() => {});
      const resolve = await freshResolveModel();
      if (baseURL !== undefined) process.env.OPENAI_BASE_URL = baseURL;
      if (override !== undefined) process.env.COPILOTKIT_OPENAI_API = override;

      await resolve("openai/gpt-5");

      expect(info).not.toHaveBeenCalled();
    });
  });

  describe("model objects", () => {
    it("returns a TanStack AI adapter unchanged", async () => {
      const adapter = createOpenaiChat("gpt-5", "test-openai-key");
      expect(await resolveModel(adapter)).toBe(adapter);
    });

    it("points an AI SDK model to the aisdk factory", async () => {
      // @ts-expect-error: an AI SDK model is not a ModelSpecifier, but plain JS
      // and stale types can still pass one at runtime.
      const result = resolveModel(aiSdkModel);
      await expect(result).rejects.toThrow(
        'Run AI SDK models with a factory: new BuiltInAgent({ type: "aisdk", factory: ... }), with the helpers in "@copilotkit/runtime/agent/ai-sdk".',
      );
    });

    it("tells an AI SDK model apart from a TanStack adapter", () => {
      expect(isAISDKLanguageModel(aiSdkModel)).toBe(true);
      expect(
        isAISDKLanguageModel(createOpenaiChat("gpt-5", "test-openai-key")),
      ).toBe(false);
    });
  });
});
