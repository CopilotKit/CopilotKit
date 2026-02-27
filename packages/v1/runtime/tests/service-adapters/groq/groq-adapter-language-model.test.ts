import { describe, it, expect, vi, beforeEach } from "vitest";
import type { OpenAIProviderSettings } from "@ai-sdk/openai";
import { GroqAdapter } from "../../../src/service-adapters/groq/groq-adapter";
import { Groq } from "groq-sdk";

// Groq uses createOpenAI (OpenAI-compatible API), so we check against
// OpenAIProviderSettings. Same exhaustiveness guard as the OpenAI test.
type ForwardedGroqKeys = "baseURL" | "apiKey" | "headers" | "fetch";

// Keys we set ourselves or that don't apply to Groq.
type ControlledGroqKeys = "name" | "organization" | "project";

type _exhaustive =
  Exclude<
    keyof OpenAIProviderSettings,
    ForwardedGroqKeys | ControlledGroqKeys
  > extends never
    ? true
    : {
        error: "OpenAIProviderSettings has unhandled keys";
        unhandled: Exclude<
          keyof OpenAIProviderSettings,
          ForwardedGroqKeys | ControlledGroqKeys
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

vi.mock("groq-sdk", () => {
  return {
    Groq: class MockGroq {
      baseURL: string;
      apiKey: string;
      _options: Record<string, any>;
      chat = { completions: { create: vi.fn() } };

      constructor(opts: any = {}) {
        this.baseURL = opts.baseURL ?? "https://api.groq.com";
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

describe("GroqAdapter.getLanguageModel()", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("forwards all provider-relevant options from the Groq SDK client", () => {
    const customFetch = vi.fn();
    const groq = new Groq({
      apiKey: "gsk-test",
      baseURL: "https://custom-groq.example.com",
      defaultHeaders: { "x-groq": "value" },
      fetch: customFetch,
    });

    const adapter = new GroqAdapter({
      groq,
      model: "llama-3.3-70b-versatile",
    });
    adapter.getLanguageModel();

    expect(mockCreateOpenAI).toHaveBeenCalledOnce();
    const settings = mockCreateOpenAI.mock.calls[0][0];

    expect(settings.baseURL).toBe("https://custom-groq.example.com");
    expect(settings.apiKey).toBe("gsk-test");
    expect(settings.headers).toEqual({ "x-groq": "value" });
    expect(settings.fetch).toBe(customFetch);
    expect(settings.name).toBe("groq");

    expect(mockProviderFn).toHaveBeenCalledWith("llama-3.3-70b-versatile");
  });

  it("works with default Groq config (no custom options)", () => {
    const groq = new Groq({ apiKey: "gsk-default" });
    const adapter = new GroqAdapter({ groq });
    adapter.getLanguageModel();

    const settings = mockCreateOpenAI.mock.calls[0][0];
    expect(settings.baseURL).toBe("https://api.groq.com");
    expect(settings.apiKey).toBe("gsk-default");
    expect(settings.name).toBe("groq");
  });
});
