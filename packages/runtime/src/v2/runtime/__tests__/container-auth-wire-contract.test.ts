/**
 * CPK-5 — Container-auth wire-contract integration test.
 *
 * Verifies the FULL end-to-end wire contract across all three paths that
 * participate in the container-auth trust model (CPK-1..4):
 *
 *   1. RUN path   — `handleRunAgent` / `handleIntelligenceRun`
 *      • Client carries `intended = ['team-a']` (the provider-set key
 *        `__copilotkit_intelligence_learning_containers__`) AND a forged
 *        `permitted = ['admin']` (the reserved trust-hinge key).
 *      • `identifyUser` returns `writableContainers: ['team-a','project']` and
 *        `readableContainers: ['team-a']`.
 *      • Assert the runner receives:
 *        - `forwardedProps[INTENDED_KEY]  === ['team-a']`   (client-owned, preserved)
 *        - `forwardedProps[PERMITTED_KEY] === ['team-a','project']`  (BFF-stamped, forgery gone)
 *
 *   2. ANNOTATE path — `handleAnnotate`
 *      • Same `identifyUser` scenario (writableContainers = ['team-a','project']).
 *      • Assert `intelligence.annotate` is called with
 *        `permitted === ['team-a','project']` (from identifyUser).
 *        The annotate body carries no forwardedProps; `permitted` is stamped directly.
 *
 *   3. MCP path   — `attachIntelligenceEnterpriseLearning`
 *      • `identifyUser` returns `readableContainers: ['team-a']`.
 *      • Assert the MCPMiddleware is constructed with
 *        `headers['x-cpki-readable-containers'] === 'team-a'`.
 *
 * These three assertions together confirm the full wire body described in CPK-5
 * is correct: client intended is preserved, BFF permitted overwrites any forgery,
 * and the MCP readable-containers header is forwarded.
 */
import type { AbstractAgent, BaseEvent } from "@ag-ui/client";
import { Observable } from "rxjs";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

// ----- MCP mock (must be hoisted before agent-utils import) -----
const mcpMiddlewareCalls: Array<unknown[]> = [];
vi.mock("@ag-ui/mcp-middleware", () => ({
  MCPMiddleware: class MockMCPMiddleware {
    constructor(...args: unknown[]) {
      mcpMiddlewareCalls.push(args);
    }
  },
}));

import { handleRunAgent } from "../handlers/handle-run";
import { handleAnnotate } from "../handlers/handle-user-actions";
import { attachIntelligenceEnterpriseLearning } from "../handlers/shared/agent-utils";
import { IntelligenceAgentRunner } from "../runner/intelligence";
import { telemetry } from "../telemetry";
import {
  INTELLIGENCE_PERMITTED_CONTAINERS_KEY,
  INTELLIGENCE_READABLE_CONTAINERS_HEADER,
} from "../intelligence-platform/client";
import type { CopilotRuntime } from "../core/runtime";
import type { AgentRunnerRunRequest } from "../runner/agent-runner";
import type { CopilotRuntimeLike } from "../core/runtime";
import { RUNTIME_MODE_INTELLIGENCE } from "@copilotkit/shared";

/** The client-owned "intended" key set by the provider (CPK-1). */
const INTENDED_KEY = "__copilotkit_intelligence_learning_containers__";
const PERMITTED_KEY = INTELLIGENCE_PERMITTED_CONTAINERS_KEY;

// ---------------------------------------------------------------------------
// Shared identifyUser for all three path assertions
// ---------------------------------------------------------------------------
const IDENTIFIED_USER = {
  id: "user-alice",
  name: "Alice",
  learningContainers: {
    readableContainers: ["team-a"],
    writableContainers: ["team-a", "project"],
  },
};

// ---------------------------------------------------------------------------
// Helpers — RUN path
// ---------------------------------------------------------------------------
function makeAgent(): AbstractAgent {
  const agent: any = {
    clone: vi.fn(() => agent),
    setMessages: vi.fn(),
    setState: vi.fn(),
    threadId: undefined,
    headers: {},
    runAgent: vi.fn().mockResolvedValue(undefined),
  };
  return agent as AbstractAgent;
}

function setupRuntime(identifiedUser: typeof IDENTIFIED_USER) {
  // Never-completing observable — keeps the run "started" without finishing.
  const never = new Observable<BaseEvent>(() => {});
  const runSpy = vi.fn((_request: AgentRunnerRunRequest) => never);

  const runner = Object.create(IntelligenceAgentRunner.prototype);
  runner.run = runSpy;

  const platform = {
    getOrCreateThread: vi.fn().mockResolvedValue({
      thread: { id: "thread-1", name: "wire-contract-thread" },
      created: false,
    }),
    getThreadMessages: vi.fn().mockResolvedValue({ messages: [] }),
    ɵacquireThreadLock: vi.fn().mockResolvedValue({
      threadId: "thread-1",
      runId: "run-1",
      joinToken: "jt-wire-1",
    }),
    ɵcleanupThreadLock: vi.fn().mockResolvedValue(undefined),
    ɵgetClientWsUrl: vi.fn(() => "wss://runtime.example/client"),
    ɵrenewThreadLock: vi.fn().mockResolvedValue(undefined),
    // annotate spy reused by annotate-path section
    annotate: vi.fn().mockResolvedValue({ id: "ann-1", duplicate: false }),
  };

  const runtime = {
    agents: Promise.resolve({ "my-agent": makeAgent() }),
    transcriptionService: undefined,
    beforeRequestMiddleware: undefined,
    afterRequestMiddleware: undefined,
    runner,
    mode: "intelligence",
    generateThreadNames: false,
    intelligence: platform,
    identifyUser: vi.fn().mockResolvedValue(identifiedUser),
    lockTtlSeconds: 20,
    lockHeartbeatIntervalSeconds: 15,
  } as unknown as CopilotRuntime;

  const runRequest = (forwardedProps: Record<string, unknown>) =>
    new Request("https://example.com/agent/my-agent/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        threadId: "thread-1",
        runId: "run-1",
        state: {},
        messages: [],
        tools: [],
        context: [],
        forwardedProps,
      }),
    });

  const annotateRequest = () =>
    new Request("https://example.com/annotate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "user_action",
        payload: { action: "clicked" },
        threadId: "thread-1",
        clientEventId: "evt-wire-1",
      }),
    });

  const receivedRunForwardedProps = () =>
    (runSpy.mock.calls[0]![0] as {
      input: { forwardedProps: Record<string, unknown> };
    }).input.forwardedProps;

  return { runtime, platform, runRequest, annotateRequest, receivedRunForwardedProps };
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------
beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(telemetry, "capture").mockResolvedValue(undefined);
  vi.spyOn(console, "error").mockImplementation(() => {});
  mcpMiddlewareCalls.length = 0;
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

// ===========================================================================
// PATH 1 — RUN
// ===========================================================================

it("RUN: preserves client intended=['team-a'] while overwriting forged permitted=['admin'] with server-resolved ['team-a','project']", async () => {
  const { runtime, runRequest, receivedRunForwardedProps } = setupRuntime(IDENTIFIED_USER);

  await handleRunAgent({
    runtime,
    request: runRequest({
      // Client-set provider key (CPK-1 / CPK-3: the intended learning target).
      [INTENDED_KEY]: ["team-a"],
      // Forged write authority the client must NOT be able to inject.
      [PERMITTED_KEY]: ["admin"],
      // Unrelated prop that must survive.
      extra: "keep-me",
    }),
    agentId: "my-agent",
  });

  const props = receivedRunForwardedProps();

  // Intended: client-owned, preserved verbatim.
  expect(props[INTENDED_KEY]).toEqual(["team-a"]);

  // Permitted: BFF-stamped from identifyUser.writableContainers — forgery gone.
  expect(props[PERMITTED_KEY]).toEqual(["team-a", "project"]);

  // Other client props survive.
  expect(props.extra).toBe("keep-me");
});

it("RUN: strips intended key is NOT in permitted — they are independent channels", async () => {
  // intended=['org'] but identifyUser only authorizes ['team-a','project']
  // The intended key must be untouched; permitted must reflect the server list.
  const { runtime, runRequest, receivedRunForwardedProps } = setupRuntime(IDENTIFIED_USER);

  await handleRunAgent({
    runtime,
    request: runRequest({
      [INTENDED_KEY]: ["org"],
      [PERMITTED_KEY]: ["admin"],
    }),
    agentId: "my-agent",
  });

  const props = receivedRunForwardedProps();
  expect(props[INTENDED_KEY]).toEqual(["org"]);           // untouched
  expect(props[PERMITTED_KEY]).toEqual(["team-a", "project"]); // server-resolved
});

// ===========================================================================
// PATH 2 — ANNOTATE
// ===========================================================================

it("ANNOTATE: stamps permitted=['team-a','project'] from identifyUser — client cannot influence it", async () => {
  const { runtime, platform, annotateRequest } = setupRuntime(IDENTIFIED_USER);

  const response = await handleAnnotate({ runtime, request: annotateRequest() });

  expect(response.status).toBe(200);
  expect(platform.annotate).toHaveBeenCalledWith(
    expect.objectContaining({
      userId: "user-alice",
      permitted: ["team-a", "project"],
    }),
  );
});

// ===========================================================================
// PATH 3 — MCP / attachIntelligenceEnterpriseLearning
// ===========================================================================

it("MCP: forwards x-cpki-readable-containers: 'team-a' when readableContainers=['team-a']", async () => {
  const agent = {
    use: vi.fn(),
  } as unknown as AbstractAgent & { use: ReturnType<typeof vi.fn> };

  const intelligenceStub = {
    ɵisEnterpriseLearningEnabled: () => true,
    ɵgetApiUrl: () => "https://intel.example.com",
    ɵgetApiKey: () => "cpk-proj_wire_test",
  };

  const mcpRuntime = {
    mode: RUNTIME_MODE_INTELLIGENCE,
    intelligence: intelligenceStub,
    identifyUser: vi.fn().mockResolvedValue(IDENTIFIED_USER),
  } as unknown as CopilotRuntimeLike;

  await attachIntelligenceEnterpriseLearning({
    runtime: mcpRuntime,
    request: new Request("http://localhost/run", { method: "POST" }),
    agent,
  });

  expect(mcpMiddlewareCalls).toHaveLength(1);
  const [servers] = mcpMiddlewareCalls[0] as [
    Array<{ headers: Record<string, string> }>,
  ];
  expect(servers[0]!.headers[INTELLIGENCE_READABLE_CONTAINERS_HEADER]).toBe("team-a");
});
