import { createAgent, createMiddleware } from "langchain";
import { describe, expect, it } from "vitest";
import { createSkillRegistryMiddleware } from "../../src/index.js";
import { testClient, installedSkillSet } from "../test-utils.js";

describe("latest compatible native API contract", () => {
  it("matches the public middleware hook and registration path", () => {
    const probe = createMiddleware({
      name: "PublicApiProbe",
      wrapModelCall: (request, handler) => handler({ ...request }),
    });
    const middleware = createSkillRegistryMiddleware({
      client: testClient(() => installedSkillSet()),
      learningContainerId: "55555555-5555-4555-8555-555555555555",
    });
    expect(
      createAgent({
        model: "openai:gpt-5.4-mini",
        tools: [],
        middleware: [probe, middleware],
      }),
    ).toBeDefined();
  });
});
