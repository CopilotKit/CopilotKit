/**
 * `classifyModelSpec` mirrors `resolveModel`'s provider switch. Nothing in the
 * type system keeps the two together, so these tests walk every provider that
 * switch accepts and fail if one of them classifies as `unknown` — which is
 * what a newly added provider would do until someone teaches the classifier
 * about it.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { BuiltInAgent, classifyModelSpec, resolveModel } from "../index";
import { MODEL_HOST_CLASSES } from "@copilotkit/shared";

/** Every provider prefix `resolveModel` accepts, with the env var that redirects it. */
const PROVIDERS = [
  { spec: "openai/gpt-4o", env: "OPENAI_BASE_URL", default: "openai" },
  {
    spec: "anthropic/claude-sonnet-4.5",
    env: "ANTHROPIC_BASE_URL",
    default: "anthropic",
  },
  {
    spec: "google/gemini-2.5-pro",
    env: "GOOGLE_GENERATIVE_AI_BASE_URL",
    default: "google",
  },
  {
    spec: "gemini/gemini-2.5-flash",
    env: "GOOGLE_GENERATIVE_AI_BASE_URL",
    default: "google",
  },
  {
    spec: "google-gemini/gemini-2.5-flash",
    env: "GOOGLE_GENERATIVE_AI_BASE_URL",
    default: "google",
  },
  { spec: "minimax/abab6.5", env: "MINIMAX_BASE_URL", default: "minimax" },
  { spec: "vertex/gemini-2.5-pro", env: null, default: "vertex" },
] as const;

const TOUCHED_ENV = [
  "OPENAI_BASE_URL",
  "ANTHROPIC_BASE_URL",
  "GOOGLE_GENERATIVE_AI_BASE_URL",
  "MINIMAX_BASE_URL",
];

describe("classifyModelSpec", () => {
  let saved: Record<string, string | undefined>;

  beforeEach(() => {
    saved = Object.fromEntries(TOUCHED_ENV.map((k) => [k, process.env[k]]));
    for (const key of TOUCHED_ENV) delete process.env[key];
  });

  afterEach(() => {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  describe("stays in step with resolveModel", () => {
    it.each(PROVIDERS)(
      "resolveModel accepts $spec and classifyModelSpec knows it",
      ({ spec, default: expected }) => {
        // Both halves matter. The first proves the provider is real; the
        // second proves the classifier was taught about it.
        //
        // Asserted against "Unknown provider" specifically rather than against
        // throwing at all: `vertex` builds from ambient Google credentials and
        // raises a settings error without them, which still means resolveModel
        // recognised the provider.
        expect(() => resolveModel(spec)).not.toThrow("Unknown provider");
        expect(classifyModelSpec(spec)).toBe(expected);
      },
    );

    it("classifies a provider resolveModel rejects as unknown", () => {
      expect(() => resolveModel("nonesuch/model")).toThrow("Unknown provider");
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
  });

  describe("spec parsing matches resolveModel", () => {
    it("accepts the colon form as well as the slash form", () => {
      expect(classifyModelSpec("openai:gpt-4o-mini")).toBe("openai");
    });

    it("ignores case and surrounding whitespace", () => {
      expect(classifyModelSpec("  OpenAI/gpt-4o  ")).toBe("openai");
    });
  });

  it("reports unknown for an already-built model", () => {
    // The endpoint was chosen before it reached us and is not recoverable:
    // an Azure-backed model still reports provider "openai.responses".
    const prebuilt = resolveModel("openai/gpt-4o");
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

  it("reports unknown for a developer-supplied model", () => {
    const agent = new BuiltInAgent({ model: resolveModel("openai/gpt-4o") });
    expect(agent.modelHostClass).toBe("unknown");
  });

  it("reports unknown for a factory config, which owns its own LLM call", () => {
    const agent = new BuiltInAgent({
      type: "custom",
      // Never invoked — constructing the agent is the whole test.
      factory: async function* () {},
    });
    expect(agent.modelHostClass).toBe("unknown");
  });
});
