import { describe, expect, it } from "vitest";
import { CopilotKitCore } from "../core";
import { HttpAgent } from "@ag-ui/client";

describe("CopilotKitCore agent ID validation", () => {
  it("should assign agent ID from registration key if agent ID is undefined", () => {
    const agent = new HttpAgent({ url: "https://example.com" });
    expect(agent.agentId).toBeUndefined();

    const core = new CopilotKitCore({
      runtimeUrl: undefined,
      agents__unsafe_dev_only: {
        myAgent: agent,
      },
    });

    expect(agent.agentId).toBe("myAgent");
    expect(core.getAgent("myAgent")).toBe(agent);
  });

  it("should allow registration when agent ID matches registration key", () => {
    const agent = new HttpAgent({ url: "https://example.com" });
    agent.agentId = "myAgent";

    const core = new CopilotKitCore({
      runtimeUrl: undefined,
      agents__unsafe_dev_only: {
        myAgent: agent,
      },
    });

    expect(agent.agentId).toBe("myAgent");
    expect(core.getAgent("myAgent")).toBe(agent);
  });

  it("should throw error when agent ID doesn't match registration key", () => {
    const agent = new HttpAgent({ url: "https://example.com" });
    agent.agentId = "differentId";

    expect(() => {
      new CopilotKitCore({
        runtimeUrl: undefined,
        agents__unsafe_dev_only: {
          myAgent: agent,
        },
      });
    }).toThrow(
      'Agent registration mismatch: Agent with ID "differentId" cannot be registered under key "myAgent". ' +
        "The agent ID must match the registration key or be undefined."
    );
  });

  it("should validate agent ID when using addAgent__unsafe_dev_only", () => {
    const core = new CopilotKitCore({
      runtimeUrl: undefined,
    });

    const agent1 = new HttpAgent({ url: "https://example.com" });
    core.addAgent__unsafe_dev_only({ id: "agent1", agent: agent1 });
    expect(agent1.agentId).toBe("agent1");

    const agent2 = new HttpAgent({ url: "https://example.com" });
    agent2.agentId = "agent2";
    core.addAgent__unsafe_dev_only({ id: "agent2", agent: agent2 });
    expect(agent2.agentId).toBe("agent2");

    const agent3 = new HttpAgent({ url: "https://example.com" });
    agent3.agentId = "wrongId";
    expect(() => {
      core.addAgent__unsafe_dev_only({ id: "agent3", agent: agent3 });
    }).toThrow(
      'Agent registration mismatch: Agent with ID "wrongId" cannot be registered under key "agent3". ' +
        "The agent ID must match the registration key or be undefined."
    );
  });

  it("should validate agent IDs when using setAgents__unsafe_dev_only", () => {
    const core = new CopilotKitCore({
      runtimeUrl: undefined,
    });

    const agent1 = new HttpAgent({ url: "https://example.com" });
    const agent2 = new HttpAgent({ url: "https://example.com" });
    agent2.agentId = "agent2";

    core.setAgents__unsafe_dev_only({
      agent1: agent1,
      agent2: agent2,
    });

    expect(agent1.agentId).toBe("agent1");
    expect(agent2.agentId).toBe("agent2");

    const agent3 = new HttpAgent({ url: "https://example.com" });
    agent3.agentId = "wrongId";

    expect(() => {
      core.setAgents__unsafe_dev_only({
        agent3: agent3,
      });
    }).toThrow(
      'Agent registration mismatch: Agent with ID "wrongId" cannot be registered under key "agent3". ' +
        "The agent ID must match the registration key or be undefined."
    );
  });

  it("should handle multiple agents with proper ID validation", () => {
    const agent1 = new HttpAgent({ url: "https://example.com" });
    const agent2 = new HttpAgent({ url: "https://example.com" });
    const agent3 = new HttpAgent({ url: "https://example.com" });

    agent2.agentId = "secondAgent";
    // agent1 and agent3 have undefined IDs

    const core = new CopilotKitCore({
      runtimeUrl: undefined,
      agents__unsafe_dev_only: {
        firstAgent: agent1,
        secondAgent: agent2,
        thirdAgent: agent3,
      },
    });

    expect(agent1.agentId).toBe("firstAgent");
    expect(agent2.agentId).toBe("secondAgent");
    expect(agent3.agentId).toBe("thirdAgent");

    expect(core.getAgent("firstAgent")).toBe(agent1);
    expect(core.getAgent("secondAgent")).toBe(agent2);
    expect(core.getAgent("thirdAgent")).toBe(agent3);
  });
});