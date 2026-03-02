import { describe, it, expect, vi, beforeEach } from "vitest";
import type { OpenAIProviderSettings } from "@ai-sdk/openai";
import { OpenAIAdapter } from "../../../src/service-adapters/openai/openai-adapter";
import OpenAI from "openai";

// Keys from OpenAIProviderSettings that we forward from the OpenAI SDK client.
// If @ai-sdk/openai adds new keys, the type assertion below will fail at
// compile time, forcing us to decide whether to forward them.
type ForwardedOpenAIKeys =
  | "baseURL"
  | "apiKey"
  | "organization"
  | "project"
  | "headers"
  | "fetch";

// We set `name` ourselves (not forwarded from the SDK client).
type ControlledOpenAIKeys = "name";

// Compile-time exhaustiveness check: every key in OpenAIProviderSettings must
// be accounted for in either ForwardedOpenAIKeys or ControlledOpenAIKeys.
// If this line errors, a new key was added to OpenAIProviderSettings that
// needs to be handled.
type _exhaustive =
  Exclude<
    keyof OpenAIProviderSettings,
    ForwardedOpenAIKeys | ControlledOpenAIKeys
  > extends never
    ? true
    : {
        error: "OpenAIProviderSettings has unhandled keys";
        unhandled: Exclude<
          keyof OpenAIProviderSettings,
          ForwardedOpenAIKeys | ControlledOpenAIKeys
        >;
      };
const _check: _exhaustive = true;

const { mockProviderFn, mockChatFn, mockCreateOpenAI } = vi.hoisted(() => {
  const mockChatFn = vi.fn().mockReturnValue({ modelId: "test-model" });
  const mockProviderFn = Object.assign(
    vi.fn().mockReturnValue({ modelId: "test-model" }),
    { chat: mockChatFn },
  );
  const mockCreateOpenAI = vi.fn().mockReturnValue(mockProviderFn);
  return { mockProviderFn, mockChatFn, mockCreateOpenAI };
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
      organization: string | null;
      project: string | null;
      _options: Record<string, any>;
      beta = { chat: { completions: { stream: vi.fn() } } };

      constructor(opts: any = {}) {
        this.baseURL = opts.baseURL ?? "https://api.openai.com/v1";
        this.apiKey = opts.apiKey ?? "default-key";
        this.organization = opts.organization ?? null;
        this.project = opts.project ?? null;
        this._options = {
          defaultHeaders: opts.defaultHeaders,
          defaultQuery: opts.defaultQuery,
          fetch: opts.fetch,
          ...opts,
        };
      }
    },
  };
});

describe("OpenAIAdapter.getLanguageModel()", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("forwards all provider-relevant options from the OpenAI SDK client", () => {
    const customFetch = vi.fn();
    const openai = new OpenAI({
      apiKey: "azure-key",
      baseURL: "https://myinstance.openai.azure.com/openai/deployments/gpt-4o",
      organization: "org-123",
      project: "proj-456",
      defaultHeaders: { "api-key": "azure-key" },
      defaultQuery: { "api-version": "2024-04-01-preview" },
      fetch: customFetch,
    });

    const adapter = new OpenAIAdapter({ openai, model: "gpt-4o" });
    adapter.getLanguageModel();

    expect(mockCreateOpenAI).toHaveBeenCalledOnce();
    const settings = mockCreateOpenAI.mock.calls[0][0];

    expect(settings.baseURL).toBe(
      "https://myinstance.openai.azure.com/openai/deployments/gpt-4o",
    );
    expect(settings.apiKey).toBe("azure-key");
    expect(settings.organization).toBe("org-123");
    expect(settings.project).toBe("proj-456");
    expect(settings.headers).toEqual({ "api-key": "azure-key" });
    expect(settings.fetch).toBe(customFetch);

    // Must use .chat() to force Chat Completions API (#3317)
    expect(mockChatFn).toHaveBeenCalledWith("gpt-4o");
    expect(mockProviderFn).not.toHaveBeenCalled();
  });

  it("works with default OpenAI config (no custom options)", () => {
    const openai = new OpenAI({ apiKey: "sk-test" });
    const adapter = new OpenAIAdapter({ openai });
    adapter.getLanguageModel();

    const settings = mockCreateOpenAI.mock.calls[0][0];
    expect(settings.baseURL).toBe("https://api.openai.com/v1");
    expect(settings.apiKey).toBe("sk-test");
    expect(settings.organization).toBeUndefined();
    expect(settings.project).toBeUndefined();
  });

  it("uses .chat() to avoid Responses API for OpenAI-compatible providers (#3317)", () => {
    const openai = new OpenAI({
      apiKey: "or-key",
      baseURL: "https://openrouter.ai/api/v1",
    });
    const adapter = new OpenAIAdapter({ openai, model: "google/gemini-2.5-flash-lite" });
    adapter.getLanguageModel();

    // provider.chat() must be called instead of provider() to prevent
    // the AI SDK from auto-selecting the Responses API, which breaks
    // OpenAI-compatible providers like OpenRouter.
    expect(mockChatFn).toHaveBeenCalledWith("google/gemini-2.5-flash-lite");
    expect(mockProviderFn).not.toHaveBeenCalled();
  });
});
