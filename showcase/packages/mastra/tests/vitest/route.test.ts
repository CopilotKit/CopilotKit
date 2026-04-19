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

const mockedGetLocalAgents = vi.mocked(MastraAgent.getLocalAgents);
const mockedGetLocalAgent = vi.mocked(getLocalAgent);

// Dynamic import AFTER vi.mock calls so the module sees the mocks.
async function importRoute() {
  return await import("../../src/app/api/copilotkit/route");
}

function makeAgent(tag: string, resourceId?: string) {
  return { __agent: tag, resourceId } as unknown as ReturnType<typeof getLocalAgent>;
}

beforeEach(() => {
  vi.resetModules();
  mockedGetLocalAgents.mockReset();
  mockedGetLocalAgent.mockReset();
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
    expect(() => buildAgents()).toThrow(/weatherAgent missing from Mastra config/);
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
    expect(() => buildAgents()).toThrow(/getLocalAgent returned null for agentic_chat/);
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
    expect(() => buildAgents()).toThrow(/collide with existing Mastra local agents.*agentic_chat/);
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

describe("POST error handling", () => {
  it("returns a 500 JSON response when buildAgents throws", async () => {
    mockedGetLocalAgents.mockReturnValue({}); // no weatherAgent → throws
    mockedGetLocalAgent.mockImplementation(({ resourceId }) =>
      makeAgent("demo", resourceId),
    );

    const route = await importRoute();
    route.__resetAgentsCacheForTests();

    const fakeReq = {} as unknown as Parameters<typeof route.POST>[0];
    const res = await route.POST(fakeReq);
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: string; message: string };
    expect(body.error).toBe("CopilotKit runtime error");
    expect(body.message).toMatch(/weatherAgent missing/);
  });
});
