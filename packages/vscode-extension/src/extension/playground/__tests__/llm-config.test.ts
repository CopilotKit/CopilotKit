import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveLlmConfig, type LlmConfigDeps } from "../llm-config";

function makeDeps(overrides: Partial<LlmConfigDeps> = {}): LlmConfigDeps {
  return {
    readSecret: vi.fn().mockResolvedValue(undefined),
    readSetting: vi.fn().mockReturnValue(undefined),
    readEnvFile: vi.fn().mockReturnValue({}),
    ...overrides,
  };
}

describe("resolveLlmConfig", () => {
  it("returns SecretStorage + settings when both are present", async () => {
    const deps = makeDeps({
      readSecret: vi.fn((k: string) =>
        Promise.resolve(
          k === "copilotkit.openai.apiKey" ? "sk-xxx" : undefined,
        ),
      ),
      readSetting: vi.fn((k: string) =>
        k === "copilotkit.playground.provider"
          ? "openai"
          : k === "copilotkit.playground.model"
            ? "gpt-4o-mini"
            : undefined,
      ),
    });
    const result = await resolveLlmConfig("/fake/ws", deps);
    expect(result).toEqual({
      source: "explicit",
      provider: "openai",
      model: "gpt-4o-mini",
      apiKey: "sk-xxx",
    });
  });

  it("auto-detects from .env when settings are empty", async () => {
    const deps = makeDeps({
      readEnvFile: vi.fn().mockReturnValue({
        OPENAI_API_KEY: "sk-auto",
        OTHER: "x",
      }),
    });
    const result = await resolveLlmConfig("/fake/ws", deps);
    expect(result.source).toBe("auto-detect");
    if (result.source !== "missing") {
      expect(result.provider).toBe("openai");
      expect(result.apiKey).toBe("sk-auto");
    }
  });

  it("prefers settings provider over auto-detect when both present (openai)", async () => {
    const deps = makeDeps({
      readSecret: vi.fn((k: string) =>
        Promise.resolve(
          k === "copilotkit.openai.apiKey" ? "sk-explicit" : undefined,
        ),
      ),
      readSetting: vi.fn((k: string) =>
        k === "copilotkit.playground.provider" ? "openai" : undefined,
      ),
      readEnvFile: vi.fn().mockReturnValue({ OPENAI_API_KEY: "sk-env" }),
    });
    const result = await resolveLlmConfig("/fake/ws", deps);
    expect(result.source).toBe("explicit");
    if (result.source !== "missing") {
      expect(result.provider).toBe("openai");
      expect(result.apiKey).toBe("sk-explicit");
    }
  });

  it("returns missing when nothing is configured", async () => {
    const result = await resolveLlmConfig("/fake/ws", makeDeps());
    expect(result).toEqual({ source: "missing" });
  });

  it("falls through to env when settings say anthropic (Plan #3 scope)", async () => {
    const deps = makeDeps({
      readSecret: vi.fn((k: string) =>
        Promise.resolve(
          k === "copilotkit.anthropic.apiKey" ? "sk-ant" : undefined,
        ),
      ),
      readSetting: vi.fn((k: string) =>
        k === "copilotkit.playground.provider" ? "anthropic" : undefined,
      ),
      readEnvFile: vi.fn().mockReturnValue({ OPENAI_API_KEY: "sk-env-oa" }),
    });
    const result = await resolveLlmConfig("/fake/ws", deps);
    // Anthropic is gated; expected to fall through to env scan and pick OpenAI.
    expect(result.source).toBe("auto-detect");
    if (result.source !== "missing") {
      expect(result.provider).toBe("openai");
      expect(result.apiKey).toBe("sk-env-oa");
    }
  });

  it("ignores ANTHROPIC_API_KEY in env during auto-detect (Plan #3 scope)", async () => {
    const deps = makeDeps({
      readEnvFile: vi.fn().mockReturnValue({ ANTHROPIC_API_KEY: "sk-ant" }),
    });
    const result = await resolveLlmConfig("/fake/ws", deps);
    expect(result).toEqual({ source: "missing" });
  });
});
