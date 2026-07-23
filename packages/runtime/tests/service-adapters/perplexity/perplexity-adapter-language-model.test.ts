import { describe, it, expect, vi, beforeEach } from "vitest";
import type { OpenAIProviderSettings } from "@ai-sdk/openai";
import { PerplexityAdapter } from "../../../src/service-adapters/perplexity/perplexity-adapter";
import OpenAI from "openai";

// Perplexity exposes an OpenAI-compatible chat completions endpoint, so we
// use createOpenAI under the hood. Same exhaustiveness guard as the OpenAI
// and Groq tests.
type ForwardedPerplexityKeys = "baseURL" | "apiKey" | "headers" | "fetch";

// Keys we set ourselves or that don't apply to Perplexity.
type ControlledPerplexityKeys = "name" | "organization" | "project";

type _exhaustive =
  Exclude<
    keyof OpenAIProviderSettings,
    ForwardedPerplexityKeys | ControlledPerplexityKeys
  > extends never
    ? true
    : {
        error: "OpenAIProviderSettings has unhandled keys";
        unhandled: Exclude<
          keyof OpenAIProviderSettings,
          ForwardedPerplexityKeys | ControlledPerplexityKeys
        >;
      };
const _check: _exhaustive = true;

const { mockProviderFn, mockCreateOpenAI } = vi.hoisted(() => {
  const mockProviderFn = vi.fn().mockReturnValue({ modelId: "test-model" });
  const mockCreateOpenAI = vi.fn().mockReturnValue(mockProviderFn);
  return { mockProviderFn, mockCreateOpenAI };
});

vi.mock("@ai-sdk/openai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@ai-sdk/openai")>();
  return { ...actual, createOpenAI: mockCreateOpenAI };
});

vi.mock("openai", () => {
  return {
    default: class MockOpenAI {
      baseURL: string;
      apiKey: string;
      _options: Record<string, any>;
      chat = { completions: { create: vi.fn() } };

      constructor(opts: any = {}) {
        this.baseURL = opts.baseURL ?? "https://api.openai.com/v1";
        this.apiKey = opts.apiKey ?? "default-key";
        this._options = {
          defaultHeaders: opts.defaultHeaders,
          fetch: opts.fetch,
          ...opts,
        };
      }
    },
  };
});

describe("PerplexityAdapter.getLanguageModel()", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("forwards all provider-relevant options from the OpenAI SDK client", () => {
    const customFetch = vi.fn();
    const perplexity = new OpenAI({
      apiKey: "pplx-test",
      baseURL: "https://api.perplexity.ai",
      defaultHeaders: { "X-Pplx-Integration": "copilotkit/1.0.0" },
      fetch: customFetch,
    });

    const adapter = new PerplexityAdapter({
      perplexity,
      model: "sonar-pro",
    });
    adapter.getLanguageModel();

    expect(mockCreateOpenAI).toHaveBeenCalledOnce();
    const settings = mockCreateOpenAI.mock.calls[0][0];

    expect(settings.baseURL).toBe("https://api.perplexity.ai");
    expect(settings.apiKey).toBe("pplx-test");
    expect(settings.headers).toEqual({
      "X-Pplx-Integration": "copilotkit/1.0.0",
    });
    expect(settings.fetch).toBe(customFetch);
    expect(settings.name).toBe("perplexity");

    expect(mockProviderFn).toHaveBeenCalledWith("sonar-pro");
  });

  it("defaults to sonar-pro when no model is provided", () => {
    const perplexity = new OpenAI({
      apiKey: "pplx-default",
      baseURL: "https://api.perplexity.ai",
    });
    const adapter = new PerplexityAdapter({ perplexity });
    adapter.getLanguageModel();

    expect(mockProviderFn).toHaveBeenCalledWith("sonar-pro");
  });

  it("attaches the X-Pplx-Integration attribution header on the lazy-initialized client", () => {
    const adapter = new PerplexityAdapter();
    adapter.getLanguageModel();

    const settings = mockCreateOpenAI.mock.calls[0][0];
    expect(settings.baseURL).toBe("https://api.perplexity.ai");
    expect(settings.headers).toBeDefined();
    expect(settings.headers["X-Pplx-Integration"]).toMatch(/^copilotkit\//);
    expect(settings.name).toBe("perplexity");
  });
});
