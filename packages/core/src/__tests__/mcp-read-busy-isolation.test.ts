import { expect, it, vi } from "vitest";
import { ProxiedCopilotRuntimeAgent } from "../agent";

it.each(["sse", "intelligence"] as const)(
  "isolates resource reads from a busy %s agent",
  async (runtimeMode) => {
    const agent = new ProxiedCopilotRuntimeAgent({
      runtimeUrl: "https://runtime.example",
      agentId: "default",
      transport: "rest",
      runtimeMode,
      ...(runtimeMode === "intelligence"
        ? { intelligence: { wsUrl: "wss://runtime.example/client" } }
        : {}),
    });
    agent.threadId = "original";
    agent.isRunning = true;
    agent.setMessages([
      { id: "original-message", role: "user", content: "preserve" },
    ]);
    agent.setState({ counter: 7 });
    agent.pendingInterrupts = [
      { id: "native-approval", reason: "tool-approval" },
    ];
    const clone = agent.clone();
    const clonedRun = vi
      .spyOn(clone, "runAgent")
      .mockResolvedValue({ result: { contents: [] }, newMessages: [] });
    vi.spyOn(agent, "clone").mockReturnValue(clone);
    const originalRun = vi
      .spyOn(agent, "runAgent")
      .mockResolvedValue({ result: {}, newMessages: [] });
    await agent.ɵrunMcpResourceRead({
      forwardedProps: {
        __proxiedMCPRequest: {
          method: "resources/read",
          params: { uri: "ui://app" },
        },
      },
    });
    expect(clonedRun).toHaveBeenCalledOnce();
    expect(originalRun).not.toHaveBeenCalled();
    expect(agent.isRunning).toBe(true);
    expect(agent.messages).toEqual([
      { id: "original-message", role: "user", content: "preserve" },
    ]);
    expect(agent.state).toEqual({ counter: 7 });
    expect(agent.pendingInterrupts).toEqual([
      { id: "native-approval", reason: "tool-approval" },
    ]);
    expect(clone.pendingInterrupts).toEqual([]);
  },
);
