import { CopilotKitIntelligence } from "@copilotkit/runtime/v2";
import { describe, expect, it, vi } from "vitest";
import { resolveRegistryConfig } from "../config.js";

const environment = {
  CPK_INTELLIGENCE_API_KEY: "environment-key",
  INTELLIGENCE_API_URL: "https://selfhosted.example.com",
  CPK_INTELLIGENCE_LEARNING_CONTAINER_ID: "environment-container",
  CPK_INTELLIGENCE_SKILLS_REVISION: "environment-revision",
};
describe("registry configuration", () => {
  it("uses explicit values before environment and defaults to five seconds", () => {
    const result = resolveRegistryConfig(
      {
        apiKey: "explicit-key",
        apiUrl: "https://explicit.example.com",
        containerId: "explicit-container",
        revision: "opaque-revision",
      },
      environment,
    );
    expect(result.client.ɵgetApiUrl()).toBe("https://explicit.example.com");
    expect(result.client.ɵgetApiKey()).toBe("explicit-key");
    expect(result).toMatchObject({
      containerId: "explicit-container",
      revision: "opaque-revision",
      freshnessWindowMs: 5000,
      requestTimeoutMs: 5000,
      debug: false,
    });
    expect(result).not.toHaveProperty("apiKey");
    expect(result).not.toHaveProperty("apiUrl");
  });
  it("constructs the canonical client from the standard environment variables", () => {
    const result = resolveRegistryConfig({}, environment);
    expect(result.client).toBeInstanceOf(CopilotKitIntelligence);
    expect(result.client.ɵgetApiUrl()).toBe(environment.INTELLIGENCE_API_URL);
    expect(result).toMatchObject({
      containerId: "environment-container",
      revision: "environment-revision",
    });
  });
  it("does not inspect connection configuration when a client is injected", () => {
    const client = new CopilotKitIntelligence({ apiKey: "injected-key" });
    const env = new Proxy(environment, {
      get(target, key) {
        if (
          key === "CPK_INTELLIGENCE_API_KEY" ||
          key === "INTELLIGENCE_API_URL"
        )
          throw new Error("Connection environment read");
        return Reflect.get(target, key);
      },
    });
    const result = resolveRegistryConfig(
      {
        client,
        get apiKey() {
          throw new Error("Second credential read");
        },
        get apiUrl() {
          throw new Error("Second endpoint read");
        },
      },
      env,
    );
    expect(result.client).toBe(client);
    expect(result.containerId).toBe("environment-container");
  });
  it("emits no log for the self-hosted environment helper", () => {
    const spies = [
      vi.spyOn(console, "warn"),
      vi.spyOn(console, "error"),
      vi.spyOn(console, "debug"),
      vi.spyOn(console, "log"),
    ];
    try {
      resolveRegistryConfig({}, environment);
      for (const spy of spies) expect(spy).not.toHaveBeenCalled();
    } finally {
      for (const spy of spies) spy.mockRestore();
    }
  });
  it("uses managed defaults and latest when optional environment values are absent", () => {
    const result = resolveRegistryConfig(
      { apiKey: "key", containerId: "container" },
      {},
    );
    expect(result.client.ɵgetApiUrl()).toBe(
      "https://api.intelligence.copilotkit.ai",
    );
    expect(result.revision).toBeUndefined();
  });
  it.each([
    { containerId: "" },
    { revision: "" },
    { freshnessWindowMs: -1 },
    { requestTimeoutMs: 0 },
    { requestTimeoutMs: Infinity },
    { debug: "true" },
    { apiKey: "" },
    { apiUrl: "file:///tmp/skills" },
  ])("returns a typed invalid configuration error", (override) => {
    expect(() =>
      resolveRegistryConfig(
        { apiKey: "key", containerId: "container", ...override },
        {},
      ),
    ).toThrowError(
      expect.objectContaining({ code: "INVALID_CONFIG", retryable: false }),
    );
  });
});
