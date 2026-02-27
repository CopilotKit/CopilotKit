import { describe, it, expect, vi, beforeEach } from "vitest";
import type { OpenAIProviderSettings } from "@ai-sdk/openai";
import { AvianAdapter } from "../../../src/service-adapters/avian/avian-adapter";

// Avian uses createOpenAI (OpenAI-compatible API), so we check against
// OpenAIProviderSettings. Same exhaustiveness guard as the OpenAI/Groq tests.
type ForwardedAvianKeys = "baseURL" | "apiKey" | "headers" | "fetch";

// Keys we set ourselves or that don't apply to Avian.
type ControlledAvianKeys = "name" | "organization" | "project";

type _exhaustive =
  Exclude<
    keyof OpenAIProviderSettings,
    ForwardedAvianKeys | ControlledAvianKeys
  > extends never
    ? true
    : {
        error: "OpenAIProviderSettings has unhandled keys";
        unhandled: Exclude<
          keyof OpenAIProviderSettings,
          ForwardedAvianKeys | ControlledAvianKeys
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
        this.baseURL = opts.baseURL ?? "https://api.avian.io/v1";
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

describe("AvianAdapter.getLanguageModel()", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("forwards all provider-relevant options from the OpenAI SDK client", () => {
    const customFetch = vi.fn();
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const OpenAI = require("openai").default;
    const openai = new OpenAI({
      apiKey: "avian-test-key",
      baseURL: "https://api.avian.io/v1",
      defaultHeaders: { "x-custom": "value" },
      fetch: customFetch,
    });

    const adapter = new AvianAdapter({
      openai,
      model: "deepseek/deepseek-v3.2",
    });
    adapter.getLanguageModel();

    expect(mockCreateOpenAI).toHaveBeenCalledOnce();
    const settings = mockCreateOpenAI.mock.calls[0][0];

    expect(settings.baseURL).toBe("https://api.avian.io/v1");
    expect(settings.apiKey).toBe("avian-test-key");
    expect(settings.headers).toEqual({ "x-custom": "value" });
    expect(settings.fetch).toBe(customFetch);
    expect(settings.name).toBe("avian");

    expect(mockProviderFn).toHaveBeenCalledWith("deepseek/deepseek-v3.2");
  });

  it("creates a client with Avian defaults when no OpenAI instance provided", () => {
    const adapter = new AvianAdapter({
      apiKey: "avian-key-123",
    });
    adapter.getLanguageModel();

    const settings = mockCreateOpenAI.mock.calls[0][0];
    expect(settings.baseURL).toBe("https://api.avian.io/v1");
    expect(settings.apiKey).toBe("avian-key-123");
    expect(settings.name).toBe("avian");

    expect(mockProviderFn).toHaveBeenCalledWith("deepseek/deepseek-v3.2");
  });

  it("uses the default model when none is specified", () => {
    const adapter = new AvianAdapter({ apiKey: "avian-key" });
    expect(adapter.model).toBe("deepseek/deepseek-v3.2");
  });

  it("uses a custom model when specified", () => {
    const adapter = new AvianAdapter({
      apiKey: "avian-key",
      model: "moonshotai/kimi-k2.5",
    });
    expect(adapter.model).toBe("moonshotai/kimi-k2.5");
  });

  it("sets provider to avian", () => {
    const adapter = new AvianAdapter();
    expect(adapter.provider).toBe("avian");
  });

  it("sets name to AvianAdapter", () => {
    const adapter = new AvianAdapter();
    expect(adapter.name).toBe("AvianAdapter");
  });
});
