import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { determineModel, startRuntimeServer } from "./server";

const PROVIDER_KEYS = [
  "OPENAI_API_KEY",
  "ANTHROPIC_API_KEY",
  "GOOGLE_API_KEY",
] as const;

describe("determineModel", () => {
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const key of PROVIDER_KEYS) {
      saved[key] = process.env[key];
      delete process.env[key];
    }
  });

  afterEach(() => {
    for (const key of PROVIDER_KEYS) {
      if (saved[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = saved[key];
      }
    }
  });

  it("returns openai model when only OPENAI_API_KEY is set", () => {
    process.env.OPENAI_API_KEY = "sk-test";
    expect(determineModel()).toBe("openai/gpt-5.2");
  });

  it("returns anthropic model when only ANTHROPIC_API_KEY is set", () => {
    process.env.ANTHROPIC_API_KEY = "sk-ant-test";
    expect(determineModel()).toBe("anthropic/claude-3-7-sonnet-20250219");
  });
});

describe("startRuntimeServer", () => {
  it("resolves a url and responds to fetch, then closes cleanly", async () => {
    const { url, close } = await startRuntimeServer();
    try {
      expect(url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/api\/copilotkit$/);
      const response = await fetch(url);
      expect(typeof response.status).toBe("number");
      expect(response.status).toBeGreaterThan(0);
    } finally {
      await close();
    }
  });
});
