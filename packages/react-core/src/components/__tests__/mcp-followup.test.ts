/**
 * Unit tests for the MCP ui/message follow-up runner (issue #5819).
 *
 * When an MCP app's ui/message follow-up is queued while the agent is busy and
 * the host then switches threads before the queued work runs, the follow-up must
 * NOT execute against the now-foreground thread (a cross-thread leak):
 *   - same thread   -> run on the shared agent (unchanged behavior)
 *   - thread changed -> drop the follow-up (no run) rather than leak it
 */
import { describe, it, expect, vi } from "vitest";
import type { AbstractAgent, RunAgentResult } from "@ag-ui/client";
import { ɵrunMcpFollowUp } from "../MCPAppsActivityRenderer";

type Host = Parameters<typeof ɵrunMcpFollowUp>[0]["host"];

function makeHost(): {
  host: Host;
  runAgent: ReturnType<typeof vi.fn>;
} {
  const runAgent = vi.fn(
    async (_p: { agent: AbstractAgent }): Promise<RunAgentResult> => ({
      result: undefined,
      newMessages: [],
    }),
  );
  return { host: { runAgent } as unknown as Host, runAgent };
}

describe("ɵrunMcpFollowUp", () => {
  it("runs on the shared agent when the thread has not changed", async () => {
    const agent = { threadId: "thread-A", agentId: "default" } as AbstractAgent;
    const { host, runAgent } = makeHost();

    await ɵrunMcpFollowUp({ host, agent, capturedThreadId: "thread-A" });

    expect(runAgent).toHaveBeenCalledTimes(1);
    expect(runAgent).toHaveBeenCalledWith({ agent });
  });

  it("treats a missing threadId as the shared 'default' thread", async () => {
    const agent = { agentId: "default" } as AbstractAgent;
    const { host, runAgent } = makeHost();

    await ɵrunMcpFollowUp({ host, agent, capturedThreadId: "default" });

    expect(runAgent).toHaveBeenCalledTimes(1);
  });

  it("drops the follow-up (no run) when the thread changed since enqueue", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    // The host moved the shared agent to another thread after enqueue.
    const agent = { threadId: "thread-B", agentId: "default" } as AbstractAgent;
    const { host, runAgent } = makeHost();

    const result = await ɵrunMcpFollowUp({
      host,
      agent,
      capturedThreadId: "thread-A",
    });

    expect(runAgent).not.toHaveBeenCalled();
    expect(result).toEqual({ result: undefined, newMessages: [] });
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
