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
        Promise.resolve(k === "copilotkit.openai.apiKey" ? "sk-xxx" : undefined),
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

  it("prefers settings provider over auto-detect when both present", async () => {
    const deps = makeDeps({
      readSecret: vi.fn().mockResolvedValue("sk-explicit"),
      readSetting: vi.fn((k: string) =>
        k === "copilotkit.playground.provider" ? "anthropic" : undefined,
      ),
      readEnvFile: vi.fn().mockReturnValue({ OPENAI_API_KEY: "sk-env" }),
    });
    const result = await resolveLlmConfig("/fake/ws", deps);
    if (result.source !== "missing") {
      expect(result.provider).toBe("anthropic");
    }
    expect(result.source).toBe("explicit");
  });

  it("returns missing when nothing is configured", async () => {
    const result = await resolveLlmConfig("/fake/ws", makeDeps());
    expect(result).toEqual({ source: "missing" });
  });
});
