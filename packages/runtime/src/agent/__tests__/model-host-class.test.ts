/**
 * `classifyModelSpec` mirrors `resolveModel`'s provider switch. Nothing in the
 * type system keeps the two together, so these tests walk every provider that
 * switch accepts and fail if one of them classifies as `unknown`, which is
 * what a newly added provider would do until someone teaches the classifier
 * about it.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { BuiltInAgent } from "../index";
import { classifyModelSpec, resolveModel } from "../model";
import { MODEL_HOST_CLASSES } from "@copilotkit/shared";
import { fakeText } from "@tanstack/ai/testing";

/** Every provider prefix `resolveModel` accepts, with the host class it gets by default. */
const PROVIDERS = [
  { spec: "openai/gpt-4o", default: "openai" },
  { spec: "anthropic/claude-sonnet-4.5", default: "anthropic" },
  { spec: "google/gemini-2.5-pro", default: "google" },
  { spec: "gemini/gemini-2.5-flash", default: "google" },
  { spec: "google-gemini/gemini-2.5-flash", default: "google" },
  { spec: "minimax/abab6.5", default: "minimax" },
  { spec: "vertex/gemini-2.5-pro", default: "vertex" },
] as const;

/** Credentials so `resolveModel` builds every adapter. */
const CREDENTIALS = {
  OPENAI_API_KEY: "test-openai-key",
  ANTHROPIC_API_KEY: "test-anthropic-key",
  GOOGLE_API_KEY: "test-google-key",
  MINIMAX_API_KEY: "test-minimax-key",
  GOOGLE_VERTEX_PROJECT: "test-project",
  GOOGLE_VERTEX_LOCATION: "us-central1",
};

const BASE_URL_ENV = [
  "OPENAI_BASE_URL",
  "ANTHROPIC_BASE_URL",
  "GOOGLE_GENERATIVE_AI_BASE_URL",
  "MINIMAX_BASE_URL",
];

describe("classifyModelSpec", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv, ...CREDENTIALS };
    for (const key of BASE_URL_ENV) delete process.env[key];
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe("stays in step with resolveModel", () => {
    it.each(PROVIDERS)(
      "resolveModel accepts $spec and classifyModelSpec knows it",
      async ({ spec, default: expected }) => {
        // Both halves matter. The first proves the provider is real; the
        // second proves the classifier was taught about it.
        await expect(resolveModel(spec)).resolves.toMatchObject({
          kind: "text",
        });
        expect(classifyModelSpec(spec)).toBe(expected);
      },
    );

    it("classifies a provider resolveModel rejects as unknown", async () => {
      await expect(resolveModel("nonesuch/model")).rejects.toThrow(
        "Unknown provider",
      );
      expect(classifyModelSpec("nonesuch/model")).toBe("unknown");
    });
  });

  describe("an OpenAI-shaped client aimed elsewhere", () => {
    it.each([
      ["https://myresource.openai.azure.com/openai/v1", "azure"],
      ["https://openrouter.ai/api/v1", "openrouter"],
      ["http://localhost:11434/v1", "local"],
      ["https://gateway.acme.example/v1", "other"],
    ])("reads OPENAI_BASE_URL=%s as %s", (baseUrl, expected) => {
      process.env.OPENAI_BASE_URL = baseUrl;
      expect(classifyModelSpec("openai/gpt-4o")).toBe(expected);
    });

    it("redirects each provider independently", () => {
      process.env.OPENAI_BASE_URL = "https://r.openai.azure.com/openai/v1";
      expect(classifyModelSpec("anthropic/claude-sonnet-4.5")).toBe(
        "anthropic",
      );
    });

    it.each([
      ["ANTHROPIC_BASE_URL", "anthropic/claude-sonnet-4.5"],
      ["GOOGLE_GENERATIVE_AI_BASE_URL", "google/gemini-2.5-pro"],
      ["MINIMAX_BASE_URL", "minimax/abab6.5"],
    ])("reads %s for %s", (envVar, spec) => {
      process.env[envVar] = "http://localhost:8080/v1";
      expect(classifyModelSpec(spec)).toBe("local");
    });
  });

  describe("spec parsing matches resolveModel", () => {
    it("accepts the colon form as well as the slash form", () => {
      expect(classifyModelSpec("openai:gpt-4o-mini")).toBe("openai");
    });

    it("ignores case and surrounding whitespace", () => {
      expect(classifyModelSpec("  OpenAI/gpt-4o  ")).toBe("openai");
    });
  });

  it("reports unknown for an already-built adapter", async () => {
    // The endpoint was chosen before it reached us and is not recoverable:
    // an adapter aimed at Azure looks the same as one on api.openai.com.
    const prebuilt = await resolveModel("openai/gpt-4o");
    expect(classifyModelSpec(prebuilt)).toBe("unknown");
  });

  it("only ever returns a member of the closed vocabulary", () => {
    for (const { spec } of PROVIDERS) {
      expect(MODEL_HOST_CLASSES).toContain(classifyModelSpec(spec));
    }
  });
});

describe("BuiltInAgent.modelHostClass", () => {
  it("classifies a configured model string", () => {
    const agent = new BuiltInAgent({ model: "anthropic/claude-sonnet-4.5" });
    expect(agent.modelHostClass).toBe("anthropic");
  });

  it("reports unknown for a TanStack AI adapter, whose endpoint was chosen before it reached us", () => {
    const agent = new BuiltInAgent({ model: fakeText() });
    expect(agent.modelHostClass).toBe("unknown");
  });

  it("reports unknown for a factory config, which owns its own LLM call", () => {
    const agent = new BuiltInAgent({
      type: "custom",
      // Never invoked: constructing the agent is the whole test.
      factory: async function* () {},
    });
    expect(agent.modelHostClass).toBe("unknown");
  });
});
