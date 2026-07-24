import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { resolveModel } from "../index";

// Mock the SDK provider factories so we can assert the options resolveModel passes them
// (the returned LanguageModel does not expose baseURL publicly, so we verify at the factory).
const createOpenAI = vi.fn((_opts?: unknown) => (modelId: string) => ({
  modelId,
  provider: "openai",
}));
const createAnthropic = vi.fn((_opts?: unknown) => (modelId: string) => ({
  modelId,
  provider: "anthropic",
}));
const createGoogleGenerativeAI = vi.fn(
  (_opts?: unknown) => (modelId: string) => ({
    modelId,
    provider: "google",
  }),
);

vi.mock("@ai-sdk/openai", () => ({
  createOpenAI: (opts: unknown) => createOpenAI(opts),
}));
vi.mock("@ai-sdk/anthropic", () => ({
  createAnthropic: (opts: unknown) => createAnthropic(opts),
}));
vi.mock("@ai-sdk/google", () => ({
  createGoogleGenerativeAI: (opts: unknown) => createGoogleGenerativeAI(opts),
}));

describe("resolveModel — custom baseURL via env", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...originalEnv };
    process.env.OPENAI_API_KEY = "test-openai-key";
    process.env.ANTHROPIC_API_KEY = "test-anthropic-key";
    process.env.GOOGLE_API_KEY = "test-google-key";
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("passes OPENAI_BASE_URL to the OpenAI provider (OpenAI-compatible endpoints)", () => {
    process.env.OPENAI_BASE_URL = "https://openrouter.ai/api/v1";
    resolveModel("openai/gpt-4o-mini");
    expect(createOpenAI).toHaveBeenCalledWith(
      expect.objectContaining({ baseURL: "https://openrouter.ai/api/v1" }),
    );
  });

  it("passes ANTHROPIC_BASE_URL to the Anthropic provider", () => {
    process.env.ANTHROPIC_BASE_URL = "https://anthropic.internal/v1";
    resolveModel("anthropic/claude-sonnet-4.5");
    expect(createAnthropic).toHaveBeenCalledWith(
      expect.objectContaining({ baseURL: "https://anthropic.internal/v1" }),
    );
  });

  it("passes GOOGLE_GENERATIVE_AI_BASE_URL to the Google provider", () => {
    process.env.GOOGLE_GENERATIVE_AI_BASE_URL =
      "https://google.internal/v1beta";
    resolveModel("google/gemini-2.5-pro");
    expect(createGoogleGenerativeAI).toHaveBeenCalledWith(
      expect.objectContaining({ baseURL: "https://google.internal/v1beta" }),
    );
  });

  it("leaves baseURL undefined when the env var is unset (default endpoint, backward compatible)", () => {
    delete process.env.OPENAI_BASE_URL;
    resolveModel("openai/gpt-4o");
    expect(createOpenAI).toHaveBeenCalledWith(
      expect.objectContaining({ baseURL: undefined }),
    );
  });
});
