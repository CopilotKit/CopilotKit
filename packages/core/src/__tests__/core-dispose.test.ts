import type { AbstractAgent } from "@ag-ui/client";
import type { RuntimeEntitlementResponse } from "@copilotkit/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CopilotKitCore, CopilotKitCoreRuntimeConnectionStatus } from "../core";
import type { FrontendToolHandlerContext } from "../types";
import {
  MockAgent,
  createAssistantMessage,
  createToolCallMessage,
} from "./test-utils";

const runtimeUrl = "https://runtime.example";

const retryableRuntimeEntitlements: RuntimeEntitlementResponse = {
  status: "unavailable",
  error: {
    code: "runtime_entitlements_unavailable",
    message: "Runtime entitlement lookup failed",
    retryable: true,
  },
};

function runtimeInfoResponse(runtimeEntitlements?: RuntimeEntitlementResponse) {
  return new Response(
    JSON.stringify({
      version: "1.0.0",
      agents: { assistant: { name: "assistant", description: "Assistant" } },
      audioFileTranscriptionEnabled: false,
      mode: "sse",
      ...(runtimeEntitlements ? { runtimeEntitlements } : {}),
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

/** A browser-like environment whose `fetch` answers from `respond`. */
function stubRuntime(respond: () => Promise<Response>) {
  const fetchMock = vi.fn(respond);
  vi.stubGlobal("window", {});
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((settle) => (resolve = settle));
  return { promise, resolve };
}

/**
 * An agent whose first run calls `waitForRelease`, a frontend tool that
 * blocks until the test releases it.
 */
function coreWithBlockingTool() {
  const core = new CopilotKitCore({});
  const agent = new MockAgent({ agentId: "assistant", threadId: "thread-1" });
  agent.setNewMessages([createToolCallMessage("waitForRelease")]);
  agent.runAgentCallback = () => {
    if (agent.runAgentCalls.length === 2) {
      agent.setNewMessages([createAssistantMessage({ content: "done" })]);
    }
  };
  // MockAgent implements only the AbstractAgent surface core uses here; it is
  // not a subclass, so it needs this one cast.
  const asAgent = agent as unknown as AbstractAgent;
  core.addAgent__unsafe_dev_only({ id: "assistant", agent: asAgent });

  const entered = deferred<AbortSignal | undefined>();
  const release = deferred<void>();
  core.addTool({
    name: "waitForRelease",
    followUp: true,
    handler: async (_args: unknown, context: FrontendToolHandlerContext) => {
      entered.resolve(context.signal);
      await release.promise;
      return "released";
    },
  });

  const run = core.runAgent({ agent: asAgent });
  return { core, agent, run, entered, release };
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("CopilotKitCore.dispose", () => {
  it("stops calling subscribers", async () => {
    const core = new CopilotKitCore({});
    const onPropertiesChanged = vi.fn();
    const onAgentsChanged = vi.fn();
    core.subscribe({ onPropertiesChanged, onAgentsChanged });

    core.dispose();
    core.setProperties({ tier: "gold" });
    core.setAgents__unsafe_dev_only({});
    await Promise.resolve();

    expect(onPropertiesChanged).not.toHaveBeenCalled();
    expect(onAgentsChanged).not.toHaveBeenCalled();
  });

  it("stops a run in flight and its running tool, with no follow-up run", async () => {
    const { core, agent, run, entered, release } = coreWithBlockingTool();
    const toolSignal = await entered.promise;

    core.dispose();
    release.resolve();
    await run;

    expect(toolSignal?.aborted).toBe(true);
    expect(agent.abortRun).toHaveBeenCalledTimes(1);
    expect(agent.runAgentCalls).toHaveLength(1);
  });

  it("does nothing on a second call", async () => {
    const { core, agent, run, entered, release } = coreWithBlockingTool();
    await entered.promise;

    core.dispose();
    core.dispose();
    release.resolve();
    await run;

    expect(agent.abortRun).toHaveBeenCalledTimes(1);
  });

  it("clears the runtime entitlement retry timer", async () => {
    vi.useFakeTimers();
    const fetchMock = stubRuntime(async () =>
      runtimeInfoResponse(retryableRuntimeEntitlements),
    );
    const core = new CopilotKitCore({ runtimeUrl, runtimeTransport: "rest" });
    await vi.waitFor(() => {
      expect(core.runtimeEntitlementRetryPending).toBe(true);
    });

    core.dispose();
    await vi.advanceTimersByTimeAsync(30_000);

    expect(vi.getTimerCount()).toBe(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("ignores a runtime reply that arrives after dispose", async () => {
    const reply = deferred<Response>();
    stubRuntime(() => reply.promise);
    const core = new CopilotKitCore({ runtimeUrl, runtimeTransport: "rest" });
    const onRuntimeConnectionStatusChanged = vi.fn();
    core.subscribe({ onRuntimeConnectionStatusChanged });

    core.dispose();
    reply.resolve(runtimeInfoResponse());
    await new Promise<void>((resolve) => setTimeout(resolve, 20));

    expect(core.runtimeConnectionStatus).toBe(
      CopilotKitCoreRuntimeConnectionStatus.Connecting,
    );
    expect(core.agents).toEqual({});
    expect(onRuntimeConnectionStatusChanged).not.toHaveBeenCalled();
  });
});
