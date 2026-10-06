import type { AbstractAgent, RunAgentInput } from "@ag-ui/client";
import { Observable } from "rxjs";
import { describe, expect, it, vi } from "vitest";
import type { CopilotRuntimeLike } from "../core/runtime";
import { resolveForwardHeadersPolicy } from "../handlers/header-utils";
import { handleRunAgent } from "../handlers/handle-run";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

function fixture() {
  const readStarted = deferred<void>();
  const finishRead = deferred<{ result: unknown; newMessages: [] }>();
  const agentRun = vi.fn((input: RunAgentInput) => {
    if (
      (
        input.forwardedProps as
          | { __proxiedMCPRequest?: { method?: string } }
          | undefined
      )?.__proxiedMCPRequest?.method === "resources/read"
    ) {
      readStarted.resolve();
      return finishRead.promise;
    }
    return Promise.resolve({ result: undefined, newMessages: [] });
  });
  const clone = () =>
    ({
      clone: vi.fn(() => clone()),
      setMessages: vi.fn(),
      setState: vi.fn(),
      runAgent: agentRun,
      abortRun: vi.fn(),
      headers: {},
    }) as unknown as AbstractAgent;
  let locked = false;
  const acquire = vi.fn(async (args: { threadId: string; runId: string }) => {
    if (locked)
      throw Object.assign(new Error("THREAD_LOCK_FAILED"), { status: 409 });
    locked = true;
    return { threadId: args.threadId, runId: args.runId, joinToken: "join" };
  });
  const platform = {
    getThread: vi.fn(async () => ({ id: "thread-1", agentId: "agent" })),
    getOrCreateThread: vi.fn(async () => ({
      thread: { id: "thread-1", agentId: "agent", name: "Existing" },
      created: false,
    })),
    getThreadMessages: vi.fn(async () => ({ messages: [] })),
    ɵacquireThreadLock: acquire,
    ɵcleanupThreadLock: vi.fn(async () => {
      locked = false;
    }),
    ɵrenewThreadLock: vi.fn(async () => ({})),
    ɵgetClientWsUrl: () => "wss://example.test/client",
  };
  const runner = {
    run: vi.fn(
      ({ agent, input }: { agent: AbstractAgent; input: RunAgentInput }) =>
        new Observable((subscriber) => {
          if (
            (
              input.forwardedProps as
                | { __proxiedMCPRequest?: { method?: string } }
                | undefined
            )?.__proxiedMCPRequest?.method === "resources/read"
          ) {
            void agent
              .runAgent({ forwardedProps: input.forwardedProps })
              .then(() => {
                locked = false;
                subscriber.complete();
              });
            return;
          }
          locked = false;
          subscriber.complete();
        }),
    ),
  };
  const runtime = {
    agents: Promise.resolve({ agent: clone() }),
    mode: "intelligence",
    intelligence: platform,
    runner,
    identifyUser: async () => ({ id: "user-1", name: "User" }),
    generateThreadNames: false,
    lockTtlSeconds: 30,
    lockHeartbeatIntervalSeconds: 15,
    forwardHeadersPolicy: resolveForwardHeadersPolicy(undefined),
  } as unknown as CopilotRuntimeLike;
  const request = (runId: string, proxy?: { method: string }) =>
    new Request("https://example.test/agent/agent/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        threadId: "thread-1",
        runId,
        messages: [],
        tools: [],
        context: [],
        state: {},
        forwardedProps: proxy ? { __proxiedMCPRequest: proxy } : {},
      }),
    });
  return {
    runtime,
    request,
    platform,
    runner,
    acquire,
    agentRun,
    readStarted,
    finishRead,
    holdLock: () => {
      locked = true;
    },
    releaseLock: () => {
      locked = false;
    },
  };
}

describe("Intelligence MCP resource reads", () => {
  it("lets an approval continue while a resource read is pending", async () => {
    const f = fixture();
    const read = handleRunAgent({
      runtime: f.runtime,
      agentId: "agent",
      request: f.request("read", { method: "resources/read" }),
    });
    await f.readStarted.promise;
    try {
      const approval = await handleRunAgent({
        runtime: f.runtime,
        agentId: "agent",
        request: f.request("approval"),
      });
      expect(approval.status).toBe(200);
      expect(f.acquire).toHaveBeenCalledTimes(1);
    } finally {
      f.finishRead.resolve({
        result: { contents: [{ uri: "ui://app", text: "html" }] },
        newMessages: [],
      });
    }
    expect(await (await read).json()).toEqual({
      kind: "mcp-resource-read",
      threadId: "thread-1",
      runId: "read",
      result: { contents: [{ uri: "ui://app", text: "html" }] },
    });
    expect(f.platform.getOrCreateThread).toHaveBeenCalledWith({
      threadId: "thread-1",
      userId: "user-1",
      agentId: "agent",
    });
    expect(f.runner.run).toHaveBeenCalledTimes(1);
  });

  it("reads while an approval holds the lock, but keeps user turns and tools/call serialized", async () => {
    const f = fixture();
    f.holdLock();
    const read = handleRunAgent({
      runtime: f.runtime,
      agentId: "agent",
      request: f.request("read", { method: "resources/read" }),
    });
    await f.readStarted.promise;
    expect(
      (
        await handleRunAgent({
          runtime: f.runtime,
          agentId: "agent",
          request: f.request("user"),
        })
      ).status,
    ).toBe(409);
    expect(
      (
        await handleRunAgent({
          runtime: f.runtime,
          agentId: "agent",
          request: f.request("tool", { method: "tools/call" }),
        })
      ).status,
    ).toBe(409);
    f.finishRead.resolve({ result: { contents: [] }, newMessages: [] });
    expect((await read).status).toBe(200);
    expect(f.acquire).toHaveBeenCalledTimes(2);
  });

  it("checks thread ownership and reports resource errors without a lock", async () => {
    const f = fixture();
    f.platform.getOrCreateThread.mockResolvedValueOnce({
      thread: { id: "thread-1", agentId: "other" },
      created: false,
    });
    expect(
      (
        await handleRunAgent({
          runtime: f.runtime,
          agentId: "agent",
          request: f.request("wrong", { method: "resources/read" }),
        })
      ).status,
    ).toBe(403);
    const read = handleRunAgent({
      runtime: f.runtime,
      agentId: "agent",
      request: f.request("error", { method: "resources/read" }),
    });
    await f.readStarted.promise;
    f.finishRead.reject(new Error("resource server failed"));
    expect((await read).status).toBe(502);
    expect(f.acquire).not.toHaveBeenCalled();
  });
});
