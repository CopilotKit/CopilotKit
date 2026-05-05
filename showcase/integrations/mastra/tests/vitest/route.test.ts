// Test-environment invariant (DO NOT remove without understanding it):
//
// The route module under test (`src/app/api/copilotkit/route.ts`) holds a
// module-level `cachedAgents` singleton. To get deterministic tests we need
// BOTH:
//
//   1. `vi.resetModules()` — forces the next dynamic `await import(...)` to
//      re-evaluate route.ts, which resets the `cachedAgents` closure back to
//      `null`. Without this the second test in a file would see the previous
//      test's cached agents and `getLocalAgents` call counts would accumulate.
//
//   2. `mockReset()` on each mocked function from `@ag-ui/mastra` — forgets
//      every prior `.mockImplementation(...)` / `.mockReturnValue(...)` AND
//      clears call history. This matters because `vi.mock(...)` factories are
//      hoisted and memoized by Vitest: the SAME mock function object is
//      returned across `resetModules()` boundaries. `resetModules()` alone
//      leaves stale implementations attached.
//
// Together they give each test a fresh route module AND fresh mock behavior.
// Removing either one reintroduces order-dependent test failures.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Stub the mastra module ahead of any imports that transitively load it,
// so `@/mastra` resolves without needing a real Mastra runtime.
vi.mock("@/mastra", () => ({
  mastra: { __stub: "mastra" },
}));

// Stub @ag-ui/mastra with controllable implementations. Tests reassign these
// per-case via vi.mocked(...).
vi.mock("@ag-ui/mastra", () => {
  return {
    MastraAgent: {
      getLocalAgents: vi.fn(),
    },
    getLocalAgent: vi.fn(),
  };
});

// Stub @copilotkit/runtime so the route module can import without pulling
// the real runtime into the test env.
vi.mock("@copilotkit/runtime", () => ({
  CopilotRuntime: vi.fn().mockImplementation(({ agents }) => ({ agents })),
  ExperimentalEmptyAdapter: vi.fn(),
  copilotRuntimeNextJSAppRouterEndpoint: vi.fn(() => ({
    handleRequest: vi.fn(async () => new Response("ok")),
  })),
}));

// next/server has no special behavior we need here, but route.ts imports types.
vi.mock("next/server", () => ({
  NextRequest: class {},
  NextResponse: {
    json: (body: unknown, init?: ResponseInit) =>
      new Response(JSON.stringify(body), {
        status: init?.status ?? 200,
        headers: { "content-type": "application/json" },
      }),
  },
}));

import { MastraAgent, getLocalAgent } from "@ag-ui/mastra";
import {
  CopilotRuntime,
  copilotRuntimeNextJSAppRouterEndpoint,
} from "@copilotkit/runtime";

const mockedGetLocalAgents = vi.mocked(MastraAgent.getLocalAgents);
const mockedGetLocalAgent = vi.mocked(getLocalAgent);
const mockedCopilotRuntime = vi.mocked(CopilotRuntime);
const mockedEndpointFactory = vi.mocked(copilotRuntimeNextJSAppRouterEndpoint);

// Dynamic import AFTER vi.mock calls so the module sees the mocks.
async function importRoute() {
  return await import("../../src/app/api/copilotkit/route");
}

function makeAgent(tag: string, resourceId?: string) {
  return { __agent: tag, resourceId } as unknown as ReturnType<
    typeof getLocalAgent
  >;
}

beforeEach(() => {
  vi.resetModules();
  mockedGetLocalAgents.mockReset();
  mockedGetLocalAgent.mockReset();
  mockedCopilotRuntime.mockClear();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("buildAgents", () => {
  it("throws a named error when weatherAgent is absent", async () => {
    mockedGetLocalAgents.mockReturnValue({});
    mockedGetLocalAgent.mockImplementation(({ resourceId }) =>
      makeAgent("demo", resourceId),
    );

    const { buildAgents } = await importRoute();
    expect(() => buildAgents()).toThrow(
      /weatherAgent missing from Mastra config/,
    );
  });

  it("produces a unique resourceId for every demo name", async () => {
    mockedGetLocalAgents.mockReturnValue({
      weatherAgent: makeAgent("weather", "mastra-weatherAgent"),
      headlessCompleteAgent: makeAgent(
        "headless-complete",
        "mastra-headlessCompleteAgent",
      ),
      sharedStateReadWriteAgent: makeAgent(
        "shared-state-rw",
        "mastra-sharedStateReadWriteAgent",
      ),
      subagentsSupervisorAgent: makeAgent(
        "subagents-supervisor",
        "mastra-subagentsSupervisorAgent",
      ),
      interruptAgent: makeAgent("interrupt", "mastra-interruptAgent"),
      multimodalAgent: makeAgent("multimodal", "mastra-multimodalAgent"),
      mcpAppsAgent: makeAgent("mcp-apps", "mastra-mcpAppsAgent"),
    });
    const seen: string[] = [];
    mockedGetLocalAgent.mockImplementation(({ resourceId }) => {
      seen.push(resourceId as string);
      return makeAgent("demo", resourceId);
    });

    const { buildAgents, demoAgentNames } = await importRoute();
    const agents = buildAgents();

    // Every demo name appears in the returned map.
    for (const name of demoAgentNames) {
      expect(agents).toHaveProperty(name);
    }
    // Every resourceId we asked for is unique and matches the
    // `mastra-<name>` convention. Demo aliases use `mastra-<demoName>`;
    // dedicated local agents (those re-bound via `getLocalAgent` outside
    // the demo loop) use `mastra-<localAgentName>`. Both must show up.
    const expected = [
      ...demoAgentNames.map((n) => `mastra-${n}`),
      "mastra-headlessCompleteAgent",
      "mastra-sharedStateReadWriteAgent",
      "mastra-subagentsSupervisorAgent",
      "mastra-interruptAgent",
      "mastra-multimodalAgent",
      "mastra-mcpAppsAgent",
    ];
    expect(new Set(seen).size).toBe(seen.length);
    expect(seen.sort()).toEqual([...expected].sort());
  });

  it("throws when getLocalAgent returns null for any demo alias", async () => {
    mockedGetLocalAgents.mockReturnValue({
      weatherAgent: makeAgent("weather", "mastra-weatherAgent"),
      headlessCompleteAgent: makeAgent(
        "headless-complete",
        "mastra-headlessCompleteAgent",
      ),
      sharedStateReadWriteAgent: makeAgent(
        "shared-state-rw",
        "mastra-sharedStateReadWriteAgent",
      ),
      subagentsSupervisorAgent: makeAgent(
        "subagents-supervisor",
        "mastra-subagentsSupervisorAgent",
      ),
      interruptAgent: makeAgent("interrupt", "mastra-interruptAgent"),
      multimodalAgent: makeAgent("multimodal", "mastra-multimodalAgent"),
      mcpAppsAgent: makeAgent("mcp-apps", "mastra-mcpAppsAgent"),
    });
    mockedGetLocalAgent.mockImplementation(({ resourceId }) => {
      if (resourceId === "mastra-agentic_chat") {
        return null as unknown as ReturnType<typeof getLocalAgent>;
      }
      return makeAgent("demo", resourceId);
    });

    const { buildAgents } = await importRoute();
    expect(() => buildAgents()).toThrow(
      /getLocalAgent returned null for agentic_chat/,
    );
  });

  it("fails loudly when a local agent name collides with a demo alias", async () => {
    mockedGetLocalAgents.mockReturnValue({
      weatherAgent: makeAgent("weather", "mastra-weatherAgent"),
      headlessCompleteAgent: makeAgent(
        "headless-complete",
        "mastra-headlessCompleteAgent",
      ),
      sharedStateReadWriteAgent: makeAgent(
        "shared-state-rw",
        "mastra-sharedStateReadWriteAgent",
      ),
      subagentsSupervisorAgent: makeAgent(
        "subagents-supervisor",
        "mastra-subagentsSupervisorAgent",
      ),
      // Simulated future drift: Mastra adds a local agent named `agentic_chat`.
      agentic_chat: makeAgent("rogue", "some-other-id"),
    });
    mockedGetLocalAgent.mockImplementation(({ resourceId }) =>
      makeAgent("demo", resourceId),
    );

    const { buildAgents } = await importRoute();
    expect(() => buildAgents()).toThrow(
      /collide with existing Mastra local agents.*agentic_chat/,
    );
  });

  it("does not collide on a clean Mastra config with the registered local agents", async () => {
    mockedGetLocalAgents.mockReturnValue({
      weatherAgent: makeAgent("weather", "mastra-weatherAgent"),
      headlessCompleteAgent: makeAgent(
        "headless-complete",
        "mastra-headlessCompleteAgent",
      ),
      sharedStateReadWriteAgent: makeAgent(
        "shared-state-rw",
        "mastra-sharedStateReadWriteAgent",
      ),
      subagentsSupervisorAgent: makeAgent(
        "subagents-supervisor",
        "mastra-subagentsSupervisorAgent",
      ),
      interruptAgent: makeAgent("interrupt", "mastra-interruptAgent"),
      multimodalAgent: makeAgent("multimodal", "mastra-multimodalAgent"),
      mcpAppsAgent: makeAgent("mcp-apps", "mastra-mcpAppsAgent"),
    });
    mockedGetLocalAgent.mockImplementation(({ resourceId }) =>
      makeAgent("demo", resourceId),
    );

    const { buildAgents } = await importRoute();
    expect(() => buildAgents()).not.toThrow();
  });
});

describe("agent cache memoization", () => {
  it("getAgents (via POST) only calls buildAgents once across requests", async () => {
    mockedGetLocalAgents.mockReturnValue({
      weatherAgent: makeAgent("weather", "mastra-weatherAgent"),
      headlessCompleteAgent: makeAgent(
        "headless-complete",
        "mastra-headlessCompleteAgent",
      ),
      sharedStateReadWriteAgent: makeAgent(
        "shared-state-rw",
        "mastra-sharedStateReadWriteAgent",
      ),
      subagentsSupervisorAgent: makeAgent(
        "subagents-supervisor",
        "mastra-subagentsSupervisorAgent",
      ),
      interruptAgent: makeAgent("interrupt", "mastra-interruptAgent"),
      multimodalAgent: makeAgent("multimodal", "mastra-multimodalAgent"),
      mcpAppsAgent: makeAgent("mcp-apps", "mastra-mcpAppsAgent"),
    });
    mockedGetLocalAgent.mockImplementation(({ resourceId }) =>
      makeAgent("demo", resourceId),
    );

    const route = await importRoute();
    route.__resetAgentsCacheForTests();

    const fakeReq = {} as unknown as Parameters<typeof route.POST>[0];
    await route.POST(fakeReq);
    await route.POST(fakeReq);
    await route.POST(fakeReq);

    // One call to getLocalAgents across three POSTs => the cache is in play.
    expect(mockedGetLocalAgents).toHaveBeenCalledTimes(1);
  });

  it("re-builds after __resetAgentsCacheForTests()", async () => {
    mockedGetLocalAgents.mockReturnValue({
      weatherAgent: makeAgent("weather", "mastra-weatherAgent"),
      headlessCompleteAgent: makeAgent(
        "headless-complete",
        "mastra-headlessCompleteAgent",
      ),
      sharedStateReadWriteAgent: makeAgent(
        "shared-state-rw",
        "mastra-sharedStateReadWriteAgent",
      ),
      subagentsSupervisorAgent: makeAgent(
        "subagents-supervisor",
        "mastra-subagentsSupervisorAgent",
      ),
      interruptAgent: makeAgent("interrupt", "mastra-interruptAgent"),
      multimodalAgent: makeAgent("multimodal", "mastra-multimodalAgent"),
      mcpAppsAgent: makeAgent("mcp-apps", "mastra-mcpAppsAgent"),
    });
    mockedGetLocalAgent.mockImplementation(({ resourceId }) =>
      makeAgent("demo", resourceId),
    );

    const route = await importRoute();
    route.__resetAgentsCacheForTests();

    const fakeReq = {} as unknown as Parameters<typeof route.POST>[0];
    await route.POST(fakeReq);
    route.__resetAgentsCacheForTests();
    await route.POST(fakeReq);

    expect(mockedGetLocalAgents).toHaveBeenCalledTimes(2);
  });

  // Contract lock: resourceId must be derived deterministically from the demo
  // name (`mastra-<name>`), so that tearing down and rebuilding the agent
  // cache produces the exact same resourceId. If this ever starts generating
  // non-stable ids (e.g. someone swaps in randomUUID), Mastra's working-memory
  // buckets would reset silently on every process restart — data loss with no
  // error. This test is the sentinel.
  it("keeps resourceId stable across __resetAgentsCacheForTests() rebuilds", async () => {
    mockedGetLocalAgents.mockReturnValue({
      weatherAgent: makeAgent("weather", "mastra-weatherAgent"),
      headlessCompleteAgent: makeAgent(
        "headless-complete",
        "mastra-headlessCompleteAgent",
      ),
      sharedStateReadWriteAgent: makeAgent(
        "shared-state-rw",
        "mastra-sharedStateReadWriteAgent",
      ),
      subagentsSupervisorAgent: makeAgent(
        "subagents-supervisor",
        "mastra-subagentsSupervisorAgent",
      ),
      interruptAgent: makeAgent("interrupt", "mastra-interruptAgent"),
      multimodalAgent: makeAgent("multimodal", "mastra-multimodalAgent"),
      mcpAppsAgent: makeAgent("mcp-apps", "mastra-mcpAppsAgent"),
    });
    mockedGetLocalAgent.mockImplementation(({ resourceId }) =>
      makeAgent("demo", resourceId),
    );

    const route = await importRoute();

    route.__resetAgentsCacheForTests();
    const firstPass = route.buildAgents();
    const firstResourceIds: Record<string, string | undefined> = {};
    for (const name of [...route.demoAgentNames, "weatherAgent"] as const) {
      firstResourceIds[name] = (
        firstPass[name as keyof typeof firstPass] as { resourceId?: string }
      ).resourceId;
    }

    route.__resetAgentsCacheForTests();
    const secondPass = route.buildAgents();
    for (const name of [...route.demoAgentNames, "weatherAgent"] as const) {
      const after = (
        secondPass[name as keyof typeof secondPass] as { resourceId?: string }
      ).resourceId;
      expect(after).toBe(firstResourceIds[name]);
    }
  });
});

describe("POST happy path", () => {
  it("instantiates CopilotRuntime with every demo agent and weatherAgent present", async () => {
    mockedGetLocalAgents.mockReturnValue({
      weatherAgent: makeAgent("weather", "mastra-weatherAgent"),
      headlessCompleteAgent: makeAgent(
        "headless-complete",
        "mastra-headlessCompleteAgent",
      ),
      sharedStateReadWriteAgent: makeAgent(
        "shared-state-rw",
        "mastra-sharedStateReadWriteAgent",
      ),
      subagentsSupervisorAgent: makeAgent(
        "subagents-supervisor",
        "mastra-subagentsSupervisorAgent",
      ),
      interruptAgent: makeAgent("interrupt", "mastra-interruptAgent"),
      multimodalAgent: makeAgent("multimodal", "mastra-multimodalAgent"),
      mcpAppsAgent: makeAgent("mcp-apps", "mastra-mcpAppsAgent"),
    });
    mockedGetLocalAgent.mockImplementation(({ resourceId }) =>
      makeAgent("demo", resourceId),
    );

    const route = await importRoute();
    route.__resetAgentsCacheForTests();

    const fakeReq = {} as unknown as Parameters<typeof route.POST>[0];
    await route.POST(fakeReq);

    // Build the shape of `agents` we expect the runtime to have seen.
    const expectedAgents: Record<string, unknown> = {
      weatherAgent: expect.anything(),
    };
    for (const name of route.demoAgentNames) {
      expectedAgents[name] = expect.anything();
    }

    expect(mockedCopilotRuntime).toHaveBeenCalledWith(
      expect.objectContaining({
        agents: expect.objectContaining(expectedAgents),
      }),
    );
  });
});

describe("POST error handling", () => {
  it("returns a 500 JSON response with an errorId (not the raw message) when buildAgents throws", async () => {
    mockedGetLocalAgents.mockReturnValue({}); // no weatherAgent → throws
    mockedGetLocalAgent.mockImplementation(({ resourceId }) =>
      makeAgent("demo", resourceId),
    );

    const route = await importRoute();
    route.__resetAgentsCacheForTests();

    const fakeReq = {} as unknown as Parameters<typeof route.POST>[0];
    const res = await route.POST(fakeReq);
    expect(res.status).toBe(500);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toEqual({
      error: "internal runtime error",
      errorId: expect.stringMatching(/[0-9a-f-]{36}/i),
    });
    // Critically: the raw error message must NOT appear in the response body.
    expect(JSON.stringify(body)).not.toMatch(/weatherAgent missing/);
  });

  it("does not leak a contrived sensitive error message to the client", async () => {
    const sensitive =
      "OPENAI_API_KEY=sk-SECRET-VALUE path=/Users/jpr5/.claude/secrets.txt";
    mockedGetLocalAgents.mockImplementation(() => {
      throw new Error(sensitive);
    });
    mockedGetLocalAgent.mockImplementation(({ resourceId }) =>
      makeAgent("demo", resourceId),
    );

    const consoleErrorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});

    const route = await importRoute();
    route.__resetAgentsCacheForTests();

    const fakeReq = {} as unknown as Parameters<typeof route.POST>[0];
    const res = await route.POST(fakeReq);

    expect(res.status).toBe(500);
    const body = (await res.json()) as Record<string, unknown>;
    // Body contains an errorId but not the raw sensitive message.
    expect(body.error).toBe("internal runtime error");
    expect(typeof body.errorId).toBe("string");
    expect(JSON.stringify(body)).not.toContain("sk-SECRET-VALUE");
    expect(JSON.stringify(body)).not.toContain("OPENAI_API_KEY");
    expect(JSON.stringify(body)).not.toContain("/Users/jpr5");

    // Server-side log DOES include the full message (operators need it).
    const loggedArgs = consoleErrorSpy.mock.calls.flat().join(" ");
    expect(loggedArgs).toContain("sk-SECRET-VALUE");

    consoleErrorSpy.mockRestore();
  });

  // Regression guard: when `wrapStreamingResponse` throws SYNCHRONOUSLY
  // (e.g. because `response.headers` is malformed), the outer handler must
  // (a) cancel the upstream body so the ReadableStream doesn't leak, and
  // (b) still return a 500 JSON envelope with an errorId. Prior to the fix
  // the cancel never happened — the body just hung, waiting for a reader
  // that never arrived.
  it("cancels the upstream body and returns 500 when wrapStreamingResponse throws", async () => {
    mockedGetLocalAgents.mockReturnValue({
      weatherAgent: makeAgent("weather", "mastra-weatherAgent"),
      headlessCompleteAgent: makeAgent(
        "headless-complete",
        "mastra-headlessCompleteAgent",
      ),
      sharedStateReadWriteAgent: makeAgent(
        "shared-state-rw",
        "mastra-sharedStateReadWriteAgent",
      ),
      subagentsSupervisorAgent: makeAgent(
        "subagents-supervisor",
        "mastra-subagentsSupervisorAgent",
      ),
      interruptAgent: makeAgent("interrupt", "mastra-interruptAgent"),
      multimodalAgent: makeAgent("multimodal", "mastra-multimodalAgent"),
      mcpAppsAgent: makeAgent("mcp-apps", "mastra-mcpAppsAgent"),
    });
    mockedGetLocalAgent.mockImplementation(({ resourceId }) =>
      makeAgent("demo", resourceId),
    );

    // Build a Response whose body exists and whose cancel() we can observe,
    // but whose headers getter throws — this is what forces the synchronous
    // failure inside `wrapStreamingResponse` (it constructs a new Response
    // from `response.headers` last, after reading `response.body`).
    const cancelSpy = vi.fn(async () => undefined);
    const body = new ReadableStream<Uint8Array>({
      start() {
        // never emits; we just need a valid, non-null ReadableStream
      },
      cancel(reason) {
        return cancelSpy(reason);
      },
    });
    // Intercept cancel at the stream level too — some runtimes route
    // Response#body.cancel() through the underlying source's cancel; others
    // forward it via the reader. Spying on the stream's own cancel() is the
    // most direct observation.
    const originalCancel = body.cancel.bind(body);
    const bodyCancelSpy = vi.fn((reason?: unknown) => originalCancel(reason));
    Object.defineProperty(body, "cancel", {
      value: bodyCancelSpy,
      writable: true,
    });

    const malformed = new Response(body, { status: 200 });
    // Force `.headers` to throw synchronously when `wrapStreamingResponse`
    // reads it to construct the wrapped Response.
    Object.defineProperty(malformed, "headers", {
      get() {
        throw new Error("malformed-headers-7a91");
      },
    });

    mockedEndpointFactory.mockReturnValueOnce({
      handleRequest: vi.fn(async () => malformed),
    } as unknown as ReturnType<typeof copilotRuntimeNextJSAppRouterEndpoint>);

    const consoleErrorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});

    const route = await importRoute();
    route.__resetAgentsCacheForTests();

    const fakeReq = {} as unknown as Parameters<typeof route.POST>[0];
    const res = await route.POST(fakeReq);

    // 500 JSON envelope, not a half-baked 200.
    expect(res.status).toBe(500);
    const jsonBody = (await res.json()) as Record<string, unknown>;
    expect(jsonBody.error).toBe("internal runtime error");
    expect(typeof jsonBody.errorId).toBe("string");

    // Upstream body was explicitly cancelled — no ReadableStream leak.
    expect(bodyCancelSpy).toHaveBeenCalledTimes(1);

    // Server-side log captured the synchronous wrap failure.
    const loggedArgs = consoleErrorSpy.mock.calls.flat().join(" ");
    expect(loggedArgs).toContain("malformed-headers-7a91");

    consoleErrorSpy.mockRestore();
  });

  // Regression guard: when handleRequest returns a streaming Response that
  // errors AFTER headers flush (typical SSE / AG-UI failure mode), the error
  // must be logged server-side with an errorId even though we can no longer
  // turn the response into a 500. Without the streaming wrapper this test
  // fails silently: the error is swallowed by the ReadableStream and never
  // reaches console.error.
  it("logs mid-stream handleRequest errors with an errorId (SSE/AG-UI failure path)", async () => {
    mockedGetLocalAgents.mockReturnValue({
      weatherAgent: makeAgent("weather", "mastra-weatherAgent"),
      headlessCompleteAgent: makeAgent(
        "headless-complete",
        "mastra-headlessCompleteAgent",
      ),
      sharedStateReadWriteAgent: makeAgent(
        "shared-state-rw",
        "mastra-sharedStateReadWriteAgent",
      ),
      subagentsSupervisorAgent: makeAgent(
        "subagents-supervisor",
        "mastra-subagentsSupervisorAgent",
      ),
      interruptAgent: makeAgent("interrupt", "mastra-interruptAgent"),
      multimodalAgent: makeAgent("multimodal", "mastra-multimodalAgent"),
      mcpAppsAgent: makeAgent("mcp-apps", "mastra-mcpAppsAgent"),
    });
    mockedGetLocalAgent.mockImplementation(({ resourceId }) =>
      makeAgent("demo", resourceId),
    );

    // Synthesise a Response whose body fails mid-stream after successfully
    // emitting one chunk (so headers have been committed before the throw).
    const midStreamMessage = "midstream-boom-8f3c2";
    const erroringBody = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("data: hello\n\n"));
        // Defer the failure so consumers see at least one chunk first.
        queueMicrotask(() => {
          controller.error(new Error(midStreamMessage));
        });
      },
    });
    const erroringResponse = new Response(erroringBody, {
      status: 200,
      headers: { "content-type": "text/event-stream" },
    });
    mockedEndpointFactory.mockReturnValueOnce({
      handleRequest: vi.fn(async () => erroringResponse),
    } as unknown as ReturnType<typeof copilotRuntimeNextJSAppRouterEndpoint>);

    const consoleErrorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});

    const route = await importRoute();
    route.__resetAgentsCacheForTests();

    const fakeReq = {} as unknown as Parameters<typeof route.POST>[0];
    const res = await route.POST(fakeReq);

    // The response headers are still 200 (streaming commitment) — we cannot
    // retroactively turn this into a 500.
    expect(res.status).toBe(200);

    // Drain the body so the wrapper's ReadableStream observes the upstream
    // error. Consumers will see an aborted stream; our job is the log.
    const reader = res.body!.getReader();
    let caught = false;
    try {
      while (true) {
        const { done } = await reader.read();
        if (done) break;
      }
    } catch {
      caught = true;
    }
    expect(caught).toBe(true);

    const loggedArgs = consoleErrorSpy.mock.calls.flat().join(" ");
    expect(loggedArgs).toContain(midStreamMessage);
    expect(loggedArgs).toMatch(/"phase":"stream"/);
    expect(loggedArgs).toMatch(/"errorId":"[0-9a-f-]{36}"/i);

    consoleErrorSpy.mockRestore();
  });
});
