import { describe, it, expect, vi } from "vitest";
import { HttpAgent } from "@ag-ui/client";
import { CopilotRuntime } from "../copilot-runtime";
import {
  resolveAgents,
  type AgentsConfig,
} from "../../../v2/runtime/core/runtime";

function createMockAgent(name = "test") {
  return new HttpAgent({ url: `https://example.com/${name}` });
}

function createMockRequest(headers?: Record<string, string>) {
  return new Request("https://example.com/agent/test/run", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify({ threadId: "thread-1", messages: [], state: {} }),
  });
}

describe("V1 CopilotRuntime with agent factory function", () => {
  it("preserves factory function through constructor (does not spread to {})", () => {
    const factory = vi.fn().mockReturnValue({
      default: createMockAgent("default"),
    });

    const runtime = new CopilotRuntime({ agents: factory });

    // The V2 instance should receive a function (factory), not an empty object.
    // Before the fix, spreading a function produced {}, losing all agents.
    const v2Agents = runtime.instance.agents;
    expect(typeof v2Agents).toBe("function");
  });

  it("factory function resolves agents on each request", async () => {
    const agentA = createMockAgent("tenant-a");
    const agentB = createMockAgent("tenant-b");

    const factory: AgentsConfig = ({ request }) => {
      const tenantId = request.headers.get("x-tenant-id");
      if (tenantId === "a") return { default: agentA };
      return { default: agentB };
    };

    const runtime = new CopilotRuntime({ agents: factory });
    const v2Agents = runtime.instance.agents;

    const requestA = createMockRequest({ "x-tenant-id": "a" });
    const resolvedA = await resolveAgents(v2Agents, requestA);
    expect(resolvedA.default).toBe(agentA);

    const requestB = createMockRequest({ "x-tenant-id": "b" });
    const resolvedB = await resolveAgents(v2Agents, requestB);
    expect(resolvedB.default).toBe(agentB);
  });

  it("merges endpoint agents with factory-resolved agents", async () => {
    const factoryAgent = createMockAgent("factory-agent");
    const factory = vi.fn().mockReturnValue({
      dynamic: factoryAgent,
    });

    // Use remoteEndpoints to generate endpoint agents that should be merged
    const runtime = new CopilotRuntime({
      agents: factory,
      remoteEndpoints: [
        {
          url: "https://example.com/endpoint",
          onBeforeRequest: undefined,
        },
      ],
    });

    const v2Agents = runtime.instance.agents;
    expect(typeof v2Agents).toBe("function");

    const request = createMockRequest();
    const resolved = await resolveAgents(v2Agents, request);

    // Factory agent should be present
    expect(resolved.dynamic).toBe(factoryAgent);
    // Factory should have been called with request context
    expect(factory).toHaveBeenCalledWith({ request });
  });

  it("static agents record still works after fix", async () => {
    const agent = createMockAgent("static");

    const runtime = new CopilotRuntime({
      agents: { myAgent: agent },
    });

    const v2Agents = runtime.instance.agents;
    const resolved = await resolveAgents(v2Agents);
    expect(resolved.myAgent).toBe(agent);
  });

  it("promised agents record still works after fix", async () => {
    const agent = createMockAgent("promised");

    const runtime = new CopilotRuntime({
      agents: Promise.resolve({ myAgent: agent }),
    });

    const v2Agents = runtime.instance.agents;
    const resolved = await resolveAgents(v2Agents);
    expect(resolved.myAgent).toBe(agent);
  });
});
