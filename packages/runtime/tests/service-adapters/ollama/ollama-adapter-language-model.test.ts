import { describe, it, expect, vi, beforeEach } from "vitest";
import { ExperimentalOllamaAdapter } from "../../../src/v1-deprecated/service-adapters/experimental/ollama/ollama-adapter";

const { mockProviderFn, mockCreateOpenAI } = vi.hoisted(() => {
  const mockProviderFn = vi.fn().mockReturnValue({ modelId: "test-model" });
  const mockCreateOpenAI = vi.fn().mockReturnValue(mockProviderFn);
  return { mockProviderFn, mockCreateOpenAI };
});

vi.mock("@ai-sdk/openai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@ai-sdk/openai")>();
  return { ...actual, createOpenAI: mockCreateOpenAI };
});

describe("ExperimentalOllamaAdapter.getLanguageModel", () => {
  beforeEach(() => {
    mockCreateOpenAI.mockClear();
    mockProviderFn.mockClear();
  });

  it("targets Ollama's OpenAI-compatible endpoint on the default host", () => {
    const adapter = new ExperimentalOllamaAdapter({ model: "llama3" });
    adapter.getLanguageModel();

    expect(mockCreateOpenAI).toHaveBeenCalledWith(
      expect.objectContaining({ baseURL: "http://127.0.0.1:11434/v1" }),
    );
    expect(mockProviderFn).toHaveBeenCalledWith("llama3");
  });

  it("forwards a custom baseUrl — the case that made #2930 unusable", () => {
    const adapter = new ExperimentalOllamaAdapter({
      model: "llama3.2",
      baseUrl: "http://my-private-ollama:11434",
    });
    adapter.getLanguageModel();

    expect(mockCreateOpenAI).toHaveBeenCalledWith(
      expect.objectContaining({ baseURL: "http://my-private-ollama:11434/v1" }),
    );
    expect(mockProviderFn).toHaveBeenCalledWith("llama3.2");
  });

  it("tolerates a trailing slash on baseUrl", () => {
    new ExperimentalOllamaAdapter({
      model: "m",
      baseUrl: "http://host:11434/",
    }).getLanguageModel();

    expect(mockCreateOpenAI).toHaveBeenCalledWith(
      expect.objectContaining({ baseURL: "http://host:11434/v1" }),
    );
  });
});
