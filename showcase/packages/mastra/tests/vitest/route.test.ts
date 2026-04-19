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
import { CopilotRuntime } from "@copilotkit/runtime";

const mockedGetLocalAgents = vi.mocked(MastraAgent.getLocalAgents);
const mockedGetLocalAgent = vi.mocked(getLocalAgent);
const mockedCopilotRuntime = vi.mocked(CopilotRuntime);

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
    // Every resourceId we asked for is unique and matches the `mastra-<name>` convention.
    const expected = demoAgentNames.map((n) => `mastra-${n}`);
    expect(new Set(seen).size).toBe(seen.length);
    expect(seen.sort()).toEqual([...expected].sort());
  });

  it("throws when getLocalAgent returns null for any demo alias", async () => {
    mockedGetLocalAgents.mockReturnValue({
      weatherAgent: makeAgent("weather", "mastra-weatherAgent"),
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

  it("does not collide on a clean Mastra config with only weatherAgent", async () => {
    mockedGetLocalAgents.mockReturnValue({
      weatherAgent: makeAgent("weather", "mastra-weatherAgent"),
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
});

describe("POST happy path", () => {
  it("instantiates CopilotRuntime with every demo agent and weatherAgent present", async () => {
    mockedGetLocalAgents.mockReturnValue({
      weatherAgent: makeAgent("weather", "mastra-weatherAgent"),
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

    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

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
});
