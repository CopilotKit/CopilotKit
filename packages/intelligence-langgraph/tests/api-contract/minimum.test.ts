import { IntelligenceClient } from "@copilotkit/intelligence";
import { createAgent } from "langchain";
import { describe, expect, it } from "vitest";
import { createSkillRegistryMiddleware } from "../../src/index.js";

describe("minimum native API contract", () => {
  it("registers the native middleware without an agent wrapper", () => {
    const middleware = createSkillRegistryMiddleware({
      client: new IntelligenceClient({
        baseUrl: "https://api.example.com",
        accessToken: "probe-token",
        projectNamespace: "probe",
        cacheRoot: ".copilotkit/probe",
      }),
      learningContainerId: "55555555-5555-4555-8555-555555555555",
    });
    const agent = createAgent({
      model: "openai:gpt-5.4-mini",
      tools: [],
      middleware: [middleware],
    });
    expect(agent).toBeDefined();
    expect(middleware.name).toBe(
      "CopilotKitIntelligenceSkillRegistryMiddleware",
    );
  });
});
