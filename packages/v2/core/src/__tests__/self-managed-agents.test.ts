import { describe, expect, it } from "vitest";
import { CopilotKitCore } from "../core";
import { HttpAgent, FilterToolCallsMiddleware } from "@ag-ui/client";

describe("CopilotKitCore selfManagedAgents", () => {
  it("should register self-managed agents and assign IDs", () => {
    const agent = new HttpAgent({ url: "https://example.com" });
    const core = new CopilotKitCore({
      runtimeUrl: undefined,
      selfManagedAgents: { myAgent: agent },
    });
    expect(agent.agentId).toBe("myAgent");
    expect(core.getAgent("myAgent")).toBe(agent);
  });

  it("should throw if selfManagedAgents agent has FilterToolCallsMiddleware", () => {
    const agent = new HttpAgent({ url: "https://example.com" });
    agent.use(new FilterToolCallsMiddleware({ allowedToolCalls: ["search"] }));

    expect(() => {
      new CopilotKitCore({
        runtimeUrl: undefined,
        selfManagedAgents: { myAgent: agent },
      });
    }).toThrow(
      /FilterToolCallsMiddleware cannot be used with selfManagedAgents/,
    );
  });

  it("should allow agents with no disallowed middlewares", () => {
    const agent = new HttpAgent({ url: "https://example.com" });
    // No middlewares — should be fine
    expect(() => {
      new CopilotKitCore({
        runtimeUrl: undefined,
        selfManagedAgents: { myAgent: agent },
      });
    }).not.toThrow();
  });

  it("should throw when setSelfManagedAgents is called with disallowed middleware", () => {
    const core = new CopilotKitCore({ runtimeUrl: undefined });
    const agent = new HttpAgent({ url: "https://example.com" });
    agent.use(new FilterToolCallsMiddleware({ allowedToolCalls: ["search"] }));

    expect(() => {
      core.setSelfManagedAgents({ myAgent: agent });
    }).toThrow(
      /FilterToolCallsMiddleware cannot be used with selfManagedAgents/,
    );
  });

  it("should merge selfManagedAgents with agents__unsafe_dev_only", () => {
    const devAgent = new HttpAgent({ url: "https://dev.com" });
    const selfAgent = new HttpAgent({ url: "https://self.com" });

    const core = new CopilotKitCore({
      runtimeUrl: undefined,
      agents__unsafe_dev_only: { devAgent },
      selfManagedAgents: { selfAgent },
    });

    expect(core.getAgent("devAgent")).toBe(devAgent);
    expect(core.getAgent("selfAgent")).toBe(selfAgent);
  });
});
