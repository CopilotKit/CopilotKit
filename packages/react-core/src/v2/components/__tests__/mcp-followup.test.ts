/**
 * Unit tests for the MCP ui/message follow-up runner (issue #5819).
 *
 * When an MCP app's ui/message follow-up is queued while the agent is busy and
 * the host then switches threads before the queued work runs, the follow-up must
 * NOT execute against the now-foreground thread (a cross-thread leak). Instead:
 *   - same thread   -> run live on the shared agent (unchanged behavior)
 *   - thread changed + runtime-backed agent -> re-home onto an isolated proxied
 *     agent pinned to the ORIGINAL thread (own event stream; reconciles on return)
 *   - thread changed + non-runtime agent -> drop the follow-up (no leak)
 */
import { describe, it, expect, vi } from "vitest";
import { ProxiedCopilotRuntimeAgent } from "@copilotkit/core";
import type { AbstractAgent, RunAgentResult } from "@ag-ui/client";
import { ɵrunMcpFollowUp } from "../MCPAppsActivityRenderer";

type Host = Parameters<typeof ɵrunMcpFollowUp>[0]["host"];

function makeHost(overrides: Partial<Host> = {}): {
  host: Host;
  runAgent: ReturnType<typeof vi.fn>;
  registerProxiedAgent: ReturnType<typeof vi.fn>;
} {
  const runAgent = vi.fn(
    async (_p: { agent: AbstractAgent }): Promise<RunAgentResult> => ({
      result: undefined,
      newMessages: [],
    }),
  );
  const registerProxiedAgent = vi.fn();
  const host = {
    runAgent,
    registerProxiedAgent,
    ...overrides,
  } as unknown as Host;
  return { host, runAgent, registerProxiedAgent };
}

describe("ɵrunMcpFollowUp", () => {
  it("runs on the shared agent when the thread has not changed", async () => {
    const agent = { threadId: "thread-A", agentId: "default" } as AbstractAgent;
    const { host, runAgent, registerProxiedAgent } = makeHost();

    await ɵrunMcpFollowUp({
      host,
      agent,
      capturedThreadId: "thread-A",
      capturedMessages: [],
      capturedState: {},
    });

    expect(runAgent).toHaveBeenCalledTimes(1);
    expect(runAgent).toHaveBeenCalledWith({ agent });
    expect(registerProxiedAgent).not.toHaveBeenCalled();
  });

  it("re-homes onto an isolated proxied agent pinned to the original thread when the thread changed", async () => {
    const shared = new ProxiedCopilotRuntimeAgent({
      agentId: "chat",
      runtimeAgentId: "runtime-default",
    });
    // The host has since moved the shared agent to another thread.
    shared.threadId = "thread-B";

    const scopedSetMessages = vi.fn();
    const scopedSetState = vi.fn();
    const scoped = {
      threadId: "",
      setMessages: scopedSetMessages,
      setState: scopedSetState,
    } as unknown as AbstractAgent;
    const unregister = vi.fn();

    const { host, runAgent, registerProxiedAgent } = makeHost();
    registerProxiedAgent.mockReturnValue({ agent: scoped, unregister });

    const capturedMessages = [
      { id: "m1", role: "user", content: "from the app" },
    ] as AbstractAgent["messages"];

    await ɵrunMcpFollowUp({
      host,
      agent: shared,
      capturedThreadId: "thread-A",
      capturedMessages,
      capturedState: { foo: 1 },
    });

    // Registered a sibling proxy against the SAME runtime agent id.
    expect(registerProxiedAgent).toHaveBeenCalledTimes(1);
    expect(registerProxiedAgent.mock.calls[0][0]).toMatchObject({
      runtimeAgentId: "runtime-default",
    });

    // Seeded with the original thread's identity + captured context.
    expect(scoped.threadId).toBe("thread-A");
    expect(scopedSetMessages).toHaveBeenCalledWith(capturedMessages);
    expect(scopedSetState).toHaveBeenCalledWith({ foo: 1 });

    // Ran on the scoped agent, NOT the shared (foreground) one.
    expect(runAgent).toHaveBeenCalledTimes(1);
    expect(runAgent).toHaveBeenCalledWith({ agent: scoped });

    // Cleaned up the transient registration.
    expect(unregister).toHaveBeenCalledTimes(1);
  });

  it("unregisters the proxy even if the scoped run throws", async () => {
    const shared = new ProxiedCopilotRuntimeAgent({
      agentId: "chat",
      runtimeAgentId: "runtime-default",
    });
    shared.threadId = "thread-B";
    const scoped = {
      threadId: "",
      setMessages: vi.fn(),
      setState: vi.fn(),
    } as unknown as AbstractAgent;
    const unregister = vi.fn();

    const { host, runAgent, registerProxiedAgent } = makeHost();
    registerProxiedAgent.mockReturnValue({ agent: scoped, unregister });
    runAgent.mockRejectedValueOnce(new Error("boom"));

    await expect(
      ɵrunMcpFollowUp({
        host,
        agent: shared,
        capturedThreadId: "thread-A",
        capturedMessages: [],
        capturedState: {},
      }),
    ).rejects.toThrow("boom");

    expect(unregister).toHaveBeenCalledTimes(1);
  });

  it("drops the follow-up (no run) when the thread changed and the agent is not runtime-backed", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    // A plain local/custom agent (not a ProxiedCopilotRuntimeAgent).
    const agent = { threadId: "thread-B", agentId: "default" } as AbstractAgent;
    const { host, runAgent, registerProxiedAgent } = makeHost();

    const result = await ɵrunMcpFollowUp({
      host,
      agent,
      capturedThreadId: "thread-A",
      capturedMessages: [],
      capturedState: {},
    });

    expect(runAgent).not.toHaveBeenCalled();
    expect(registerProxiedAgent).not.toHaveBeenCalled();
    expect(result).toEqual({ result: undefined, newMessages: [] });
    warn.mockRestore();
  });
});
