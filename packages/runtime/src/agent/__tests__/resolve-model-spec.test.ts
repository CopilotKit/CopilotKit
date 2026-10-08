import { afterEach, beforeEach, describe, expect, it } from "vitest";
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
    delete process.env.ANTHROPIC_BASE_URL;
    delete process.env.GOOGLE_GENERATIVE_AI_BASE_URL;
    delete process.env.MINIMAX_BASE_URL;
    process.env.GOOGLE_VERTEX_PROJECT = "test-project";
    process.env.GOOGLE_VERTEX_LOCATION = "us-central1";
  });

  afterEach(() => {
    process.env = originalEnv;
  });

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

  it("uses chat completions when OPENAI_BASE_URL points at a non-OpenAI host", () => {
    process.env.OPENAI_BASE_URL = "https://openrouter.ai/api/v1";
    expect(resolved("openai/meta-llama/llama-3.3-70b")).toEqual({
      provider: "openai.chat",
      modelId: "meta-llama/llama-3.3-70b",
    });
  });

  it("keeps the Responses API when OPENAI_BASE_URL is api.openai.com", () => {
    process.env.OPENAI_BASE_URL = "https://api.openai.com/v1";
    expect(resolved("openai/gpt-5")).toEqual({
      provider: "openai.responses",
      modelId: "gpt-5",
    });
  });

  it("keeps the Responses API when OPENAI_BASE_URL is unset", () => {
    expect(resolved("openai/gpt-5")).toEqual({
      provider: "openai.responses",
      modelId: "gpt-5",
    });
  });
});
