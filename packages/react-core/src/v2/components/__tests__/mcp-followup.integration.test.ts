/**
 * Integration coverage for the MCP ui/message follow-up re-home path (#5819).
 *
 * Unit tests (mcp-followup.test.ts) mock the host, so they prove the branching
 * but not the real wire behavior. These tests drive the ACTUAL
 * `CopilotKitCore` + `RunHandler` + `ProxiedCopilotRuntimeAgent` machinery
 * (via `registerProxiedAgent`) against a mocked runtime transport, verifying the
 * properties that only emerge end-to-end:
 *
 *   1. the re-homed run reaches the runtime tagged with the ORIGINAL threadId
 *      (so it executes against — and persists to — that thread, not the
 *      foreground one), and
 *   2. it runs on an isolated agent instance whose events never reach the
 *      shared/foreground agent, and the transient proxy is unregistered after.
 *
 * Reconciliation-on-return (a later `connectAgent(threadId)` replaying the
 * persisted follow-up) is a runtime + connect concern already covered by
 * core-connect-passive-replay / core-connect-thread-switch; here we assert the
 * client's half — that the run is addressed to the origin thread.
 *
 * Harness mirrors packages/core/src/__tests__/proxied-runtime-transport.test.ts.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { CopilotKitCore } from "@copilotkit/core";
import type { AbstractAgent, Message } from "@ag-ui/client";
import { ɵrunMcpFollowUp } from "../MCPAppsActivityRenderer";

const encoder = new TextEncoder();
const RUNTIME_URL = "https://runtime.example/rest";

/** A minimal successful SSE run stream (RUN_STARTED -> RUN_FINISHED). */
function createSseResponse(): Response {
  const stream = new ReadableStream({
    start(controller) {
      const events = [
        { type: "RUN_STARTED", threadId: "ignored", runId: "r" },
        {
          type: "RUN_FINISHED",
          threadId: "ignored",
          runId: "r",
          result: { newMessages: [] },
        },
      ];
      controller.enqueue(
        encoder.encode(
          events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join(""),
        ),
      );
      controller.close();
    },
  });
  return new Response(stream, {
    status: 200,
    headers: { "content-type": "text/event-stream" },
  });
}

/** Route fetch: capture REST `/run` calls, hand everything else (e.g. /info) a benign 200. */
function installFetchMock() {
  const runCalls: Array<{ url: string; body: any }> = [];
  const fetchMock = vi.fn(async (url: any, init?: any) => {
    const u = String(url);
    if (u.endsWith("/run")) {
      runCalls.push({
        url: u,
        body: init?.body ? JSON.parse(init.body as string) : undefined,
      });
      return createSseResponse();
    }
    return new Response(JSON.stringify({ version: "1.0.0", agents: {} }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  });
  global.fetch = fetchMock as unknown as typeof fetch;
  return { fetchMock, runCalls };
}

describe("ɵrunMcpFollowUp — integration (real proxied agent + transport)", () => {
  const originalFetch = global.fetch;
  let core: CopilotKitCore;

  afterEach(() => {
    vi.restoreAllMocks();
    global.fetch = originalFetch;
  });

  it("re-homes the run to the runtime addressed to the ORIGINAL thread when the host switched threads", async () => {
    const { runCalls } = installFetchMock();
    core = new CopilotKitCore({
      runtimeUrl: RUNTIME_URL,
      runtimeTransport: "rest",
    });

    // The shared chat agent, now moved to a different thread by the host.
    const { agent: shared } = core.registerProxiedAgent({
      agentId: "chat",
      runtimeAgentId: "default",
    });
    shared.threadId = "thread-B";

    // Capture what the proxy id was so we can assert it is cleaned up.
    const realRegister = core.registerProxiedAgent.bind(core);
    let proxyId: string | undefined;
    vi.spyOn(core, "registerProxiedAgent").mockImplementation((params) => {
      proxyId = params.agentId;
      return realRegister(params);
    });

    const appMessage = {
      id: "app-msg",
      role: "user",
      content: "sent from the MCP app on thread-A",
    } as Message;

    await ɵrunMcpFollowUp({
      host: core,
      agent: shared,
      capturedThreadId: "thread-A",
      capturedMessages: [appMessage],
      capturedState: {},
    });

    // Exactly one run hit the runtime...
    expect(runCalls.length).toBe(1);
    // ...routed to the shared runtime agent id...
    expect(runCalls[0].url).toBe(`${RUNTIME_URL}/agent/default/run`);
    // ...but tagged with the ORIGINAL thread, not the foreground 'thread-B'.
    expect(runCalls[0].body.threadId).toBe("thread-A");
    // ...carrying the captured message from thread-A.
    expect(runCalls[0].body.messages).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: "app-msg" })]),
    );

    // The transient proxy was registered and then cleaned up.
    expect(proxyId).toBeDefined();
    expect(proxyId).not.toBe("chat");
    expect(core.getAgent(proxyId!)).toBeUndefined();
  });

  it("does not stream the re-homed run through the shared/foreground agent", async () => {
    installFetchMock();
    core = new CopilotKitCore({
      runtimeUrl: RUNTIME_URL,
      runtimeTransport: "rest",
    });

    const { agent: shared } = core.registerProxiedAgent({
      agentId: "chat",
      runtimeAgentId: "default",
    });
    shared.threadId = "thread-B";

    const onRunStartedInitialized = vi.fn();
    const onMessagesChanged = vi.fn();
    shared.subscribe({
      onRunInitialized: onRunStartedInitialized,
      onMessagesChanged,
    });

    await ɵrunMcpFollowUp({
      host: core,
      agent: shared,
      capturedThreadId: "thread-A",
      capturedMessages: [],
      capturedState: {},
    });

    // The run executed on an isolated proxy instance — the shared agent (which
    // the foreground thread-B view is bound to) saw none of its lifecycle.
    expect(onRunStartedInitialized).not.toHaveBeenCalled();
    expect(shared.isRunning).toBe(false);
    expect((shared as AbstractAgent).messages).toEqual([]);
  });
});
