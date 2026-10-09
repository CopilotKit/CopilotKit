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

  it("falls back to UNIFY_API_KEY when the constructor gave none", () => {
    // Previously the adapter stored the literal string "UNIFY_API_KEY" as the
    // key, so the default path shipped a placeholder credential and every
    // request came back 401.
    process.env.UNIFY_API_KEY = "unify-key-from-env";
    try {
      new UnifyAdapter({ model: "gpt-4o@openai" }).getLanguageModel();
      expect(mockCreateOpenAI).toHaveBeenCalledWith(
        expect.objectContaining({ apiKey: "unify-key-from-env" }),
      );
    } finally {
      delete process.env.UNIFY_API_KEY;
    }
  });

  it("never ships the literal placeholder as a credential", () => {
    delete process.env.UNIFY_API_KEY;
    new UnifyAdapter({ model: "gpt-4o@openai" }).getLanguageModel();
    expect(mockCreateOpenAI.mock.calls[0][0].apiKey).not.toBe("UNIFY_API_KEY");
  });
});
