import { describe, it, expect, vi, beforeEach } from "vitest";
import { UnifyAdapter } from "../../../src/v1-deprecated/service-adapters/unify/unify-adapter";

const { mockProviderFn, mockCreateOpenAI } = vi.hoisted(() => {
  const mockProviderFn = vi.fn().mockReturnValue({ modelId: "test-model" });
  const mockCreateOpenAI = vi.fn().mockReturnValue(mockProviderFn);
  return { mockProviderFn, mockCreateOpenAI };
});

vi.mock("@ai-sdk/openai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@ai-sdk/openai")>();
  return { ...actual, createOpenAI: mockCreateOpenAI };
});

describe("UnifyAdapter.getLanguageModel", () => {
  beforeEach(() => {
    mockCreateOpenAI.mockClear();
    mockProviderFn.mockClear();
  });

  it("carries the adapter's own apiKey rather than falling back to the environment", () => {
    const adapter = new UnifyAdapter({
      apiKey: "unify-key-from-constructor",
      model: "gpt-4o@openai",
    });
    adapter.getLanguageModel();

    expect(mockCreateOpenAI).toHaveBeenCalledWith(
      expect.objectContaining({
        baseURL: "https://api.unify.ai/v0/",
        apiKey: "unify-key-from-constructor",
      }),
    );
    expect(mockProviderFn).toHaveBeenCalledWith("gpt-4o@openai");
  });
});
