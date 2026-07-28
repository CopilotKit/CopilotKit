import { describe, it, expect, vi, beforeEach } from "vitest";
import type { AbstractAgent } from "@ag-ui/client";

// Capture every MCPMiddleware constructor call so we can assert on the
// config (URL, headers) the runtime baked into it.
const mcpMiddlewareCalls: Array<unknown[]> = [];
vi.mock("@ag-ui/mcp-middleware", () => ({
  MCPMiddleware: class MockMCPMiddleware {
    constructor(...args: unknown[]) {
      mcpMiddlewareCalls.push(args);
    }
  },
}));

import { attachIntelligenceEnterpriseLearning } from "../agent-utils";
import { INTELLIGENCE_USER_ID_HEADER } from "../../../intelligence-platform/client";
import type { CopilotRuntimeLike } from "../../../core/runtime";
import { RUNTIME_MODE_INTELLIGENCE, logger } from "@copilotkit/shared";

interface IntelligenceStub {
  ɵisEnterpriseLearningEnabled: () => boolean;
  ɵgetApiUrl: () => string;
  ɵgetApiKey: () => string;
}

function makeAgent(): AbstractAgent & {
  use: ReturnType<typeof vi.fn>;
} {
  const agent = {
    use: vi.fn(),
  } as unknown as AbstractAgent & { use: ReturnType<typeof vi.fn> };
  return agent;
}

function makeRuntime(opts: {
  intelligence?: IntelligenceStub;
  identifyUser?: (req: Request) => Promise<{ id: string; name: string }>;
}): CopilotRuntimeLike {
  return {
    mode: opts.intelligence ? RUNTIME_MODE_INTELLIGENCE : "sse",
    intelligence: opts.intelligence,
    identifyUser: opts.identifyUser,
  } as unknown as CopilotRuntimeLike;
}

function makeIntelligenceStub(
  overrides: Partial<IntelligenceStub> = {},
): IntelligenceStub {
  return {
    ɵisEnterpriseLearningEnabled: () => true,
    ɵgetApiUrl: () => "https://intel.example.com",
    ɵgetApiKey: () => "cpk-proj_test_key",
    ...overrides,
  };
}

const request = (): Request =>
  new Request("http://localhost/run", { method: "POST" });

beforeEach(() => {
  mcpMiddlewareCalls.length = 0;
});

describe("attachIntelligenceEnterpriseLearning", () => {
  it("does nothing when the runtime is not an intelligence runtime", async () => {
    const agent = makeAgent();
    await attachIntelligenceEnterpriseLearning({
      runtime: makeRuntime({}),
      agent,
      user: { id: "user-42", name: "Forty Two" },
    });
    expect(agent.use).not.toHaveBeenCalled();
    expect(mcpMiddlewareCalls).toHaveLength(0);
  });

  it("does nothing when enableEnterpriseLearning is off", async () => {
    const agent = makeAgent();
    await attachIntelligenceEnterpriseLearning({
      runtime: makeRuntime({
        intelligence: makeIntelligenceStub({
          ɵisEnterpriseLearningEnabled: () => false,
        }),
        identifyUser: async () => ({ id: "u1", name: "User" }),
      }),
      agent,
      user: { id: "user-42", name: "Forty Two" },
    });
    expect(agent.use).not.toHaveBeenCalled();
  });

  it("attaches MCPMiddleware with the apiKey + resolved user-id baked into headers", async () => {
    const agent = makeAgent();
    await attachIntelligenceEnterpriseLearning({
      runtime: makeRuntime({
        intelligence: makeIntelligenceStub(),
        identifyUser: async () => ({ id: "user-42", name: "Forty Two" }),
      }),
      agent,
      user: { id: "user-42", name: "Forty Two" },
    });

    expect(agent.use).toHaveBeenCalledTimes(1);
    expect(mcpMiddlewareCalls).toHaveLength(1);
    const [servers] = mcpMiddlewareCalls[0] as [unknown[]];
    expect(servers).toEqual([
      {
        type: "http",
        url: "https://intel.example.com/mcp",
        serverId: "intelligence",
        headers: {
          Authorization: "Bearer cpk-proj_test_key",
          [INTELLIGENCE_USER_ID_HEADER]: "user-42",
        },
      },
    ]);
  });

  it("does not attach when the supplied user id is invalid", async () => {
    // Same intent as before OSS-643 (an unusable identity must not be stamped
    // into the MCP header), but the identity now arrives as an argument rather
    // than being resolved in here. The HTTP path validates upstream; this is the
    // defence-in-depth guard for the Channel path.
    const agent = makeAgent();
    await attachIntelligenceEnterpriseLearning({
      runtime: makeRuntime({ intelligence: makeIntelligenceStub() }),
      agent,
      user: { id: "", name: "x" },
    });
    expect(agent.use).not.toHaveBeenCalled();
  });

  it("does not attach when the supplied user id could forge a header", async () => {
    const agent = makeAgent();
    await attachIntelligenceEnterpriseLearning({
      runtime: makeRuntime({ intelligence: makeIntelligenceStub() }),
      agent,
      user: { id: "slack:T1:U9\r\nx-injected: 1", name: "Ada" },
    });
    expect(agent.use).not.toHaveBeenCalled();
  });

  it("never calls identifyUser — the caller resolves the user once", async () => {
    const identifyUser = vi.fn(async () => ({ id: "u1", name: "User" }));
    const agent = makeAgent();
    await attachIntelligenceEnterpriseLearning({
      runtime: makeRuntime({
        intelligence: makeIntelligenceStub(),
        identifyUser,
      }),
      agent,
      user: { id: "slack:T1:U9", name: "Ada" },
    });
    expect(identifyUser).not.toHaveBeenCalled();
    expect(agent.use).toHaveBeenCalledTimes(1);
  });

  it("accepts a long opaque Teams app-user id", async () => {
    const agent = makeAgent();
    const id = `teams:tenant1:29:1${"a".repeat(200)}`;
    await attachIntelligenceEnterpriseLearning({
      runtime: makeRuntime({ intelligence: makeIntelligenceStub() }),
      agent,
      user: { id, name: "Sam" },
    });
    const [servers] = mcpMiddlewareCalls[0] as [
      Array<{ headers: Record<string, string> }>,
    ];
    expect(servers[0]?.headers["x-cpki-user-id"]).toBe(id);
  });

  it("keeps two concurrent attachments isolated", async () => {
    const a = makeAgent();
    const b = makeAgent();
    await Promise.all([
      attachIntelligenceEnterpriseLearning({
        runtime: makeRuntime({ intelligence: makeIntelligenceStub() }),
        agent: a,
        user: { id: "slack:T1:UA", name: "A" },
      }),
      attachIntelligenceEnterpriseLearning({
        runtime: makeRuntime({ intelligence: makeIntelligenceStub() }),
        agent: b,
        user: { id: "slack:T1:UB", name: "B" },
      }),
    ]);
    const ids = mcpMiddlewareCalls.map(
      ([servers]) =>
        (servers as Array<{ headers: Record<string, string> }>)[0]?.headers[
          "x-cpki-user-id"
        ],
    );
    expect(ids.sort()).toEqual(["slack:T1:UA", "slack:T1:UB"]);
  });

  it("warns and does not attach when the agent does not expose a use() method", async () => {
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => undefined);
    const agent = {} as AbstractAgent; // no `use`
    await attachIntelligenceEnterpriseLearning({
      runtime: makeRuntime({
        intelligence: makeIntelligenceStub(),
        identifyUser: async () => ({ id: "u1", name: "User" }),
      }),
      agent,
      user: { id: "user-42", name: "Forty Two" },
    });
    expect(mcpMiddlewareCalls).toHaveLength(0);
    // The operator opted into the feature, so the no-op must be surfaced.
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
  });
});
