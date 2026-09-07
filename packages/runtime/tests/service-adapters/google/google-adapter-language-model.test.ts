import { describe, it, expect, vi, beforeEach } from "vitest";
import { GoogleGenerativeAIAdapter } from "../../../src/v1-deprecated/service-adapters/google/google-genai-adapter";

const { mockProviderFn, mockCreateGoogle } = vi.hoisted(() => {
  const mockProviderFn = vi.fn().mockReturnValue({ modelId: "test-model" });
  const mockCreateGoogle = vi.fn().mockReturnValue(mockProviderFn);
  return { mockProviderFn, mockCreateGoogle };
});

vi.mock("@ai-sdk/google", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@ai-sdk/google")>();
  return { ...actual, createGoogleGenerativeAI: mockCreateGoogle };
});

describe("GoogleGenerativeAIAdapter.getLanguageModel", () => {
  beforeEach(() => {
    mockCreateGoogle.mockClear();
    mockProviderFn.mockClear();
    delete process.env.GOOGLE_API_KEY;
  });

  it("carries the constructor apiKey rather than falling back to the environment", () => {
    process.env.GOOGLE_API_KEY = "env-key-that-must-not-win";
    const adapter = new GoogleGenerativeAIAdapter({
      apiKey: "key-from-constructor",
      model: "gemini-1.5-flash",
    });
    adapter.getLanguageModel();

    expect(mockCreateGoogle).toHaveBeenCalledWith({
      apiKey: "key-from-constructor",
    });
    expect(mockProviderFn).toHaveBeenCalledWith("gemini-1.5-flash");
  });

  it("falls back to GOOGLE_API_KEY when the constructor gave none", () => {
    process.env.GOOGLE_API_KEY = "env-key";
    new GoogleGenerativeAIAdapter({
      model: "gemini-1.5-flash",
    }).getLanguageModel();

    expect(mockCreateGoogle).toHaveBeenCalledWith({ apiKey: "env-key" });
  });
});
