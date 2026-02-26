import { describe, expect, it } from "vitest";
import { HttpAgent, FilterToolCallsMiddleware } from "@ag-ui/client";
import { validateSelfManagedAgentMiddlewares } from "../core/self-managed-agent-validator";

describe("validateSelfManagedAgentMiddlewares", () => {
  it("should pass for an agent with no middlewares", () => {
    const agent = new HttpAgent({ url: "https://example.com" });
    expect(() =>
      validateSelfManagedAgentMiddlewares("myAgent", agent),
    ).not.toThrow();
  });

  it("should throw for an agent with FilterToolCallsMiddleware", () => {
    const agent = new HttpAgent({ url: "https://example.com" });
    agent.use(new FilterToolCallsMiddleware({ allowedToolCalls: ["search"] }));
    expect(() => validateSelfManagedAgentMiddlewares("myAgent", agent)).toThrow(
      /FilterToolCallsMiddleware cannot be used with selfManagedAgents/,
    );
  });

  it("should include agent name in error message", () => {
    const agent = new HttpAgent({ url: "https://example.com" });
    agent.use(
      new FilterToolCallsMiddleware({ disallowedToolCalls: ["dangerous"] }),
    );
    expect(() =>
      validateSelfManagedAgentMiddlewares("badAgent", agent),
    ).toThrow(/badAgent/);
  });
});
