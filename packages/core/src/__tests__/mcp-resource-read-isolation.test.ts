import { describe, expect, it, vi } from "vitest";
import { ProxiedCopilotRuntimeAgent } from "../agent";

describe("proxied MCP resource read isolation", () => {
  it("runs a resource read on a clone and rejects other MCP methods", async () => {
    const agent = new ProxiedCopilotRuntimeAgent({
      runtimeUrl: "https://runtime.example",
      agentId: "agent",
      runtimeMode: "intelligence",
      intelligence: { wsUrl: "wss://intelligence.example/client" },
    });
    agent.threadId = "thread-1";
    const clone = agent.clone();
    const cloneRun = vi.spyOn(clone, "runAgent").mockResolvedValue({
      result: { contents: [{ uri: "ui://app", text: "html" }] },
      newMessages: [],
    });
    vi.spyOn(agent, "clone").mockReturnValue(clone);
    const originalRun = vi.spyOn(agent, "runAgent");

    const result = await agent.ɵrunMcpResourceRead({
      forwardedProps: {
        __proxiedMCPRequest: {
          method: "resources/read",
          params: { uri: "ui://app" },
        },
      },
    });
    expect(result.result).toEqual({
      contents: [{ uri: "ui://app", text: "html" }],
    });
    expect(clone.threadId).toBe("thread-1");
    expect(cloneRun).toHaveBeenCalledOnce();
    expect(originalRun).not.toHaveBeenCalled();

    await expect(
      agent.ɵrunMcpResourceRead({
        forwardedProps: { __proxiedMCPRequest: { method: "tools/call" } },
      }),
    ).rejects.toThrow("Only MCP resources/read");
    expect(cloneRun).toHaveBeenCalledOnce();
  });
});
