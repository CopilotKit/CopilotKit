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
import { INTELLIGENCE_MEMORY_GRANT_HEADER } from "../../../intelligence-platform/client";
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
  memory?: CopilotRuntimeLike["memory"];
}): CopilotRuntimeLike {
  return {
    mode: opts.intelligence ? RUNTIME_MODE_INTELLIGENCE : "sse",
    intelligence: opts.intelligence,
    identifyUser: opts.identifyUser,
    memory: opts.memory,
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
      request: request(),
      agent,
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
      request: request(),
      agent,
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
      request: request(),
      agent,
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

  it("evaluates agent Memory once and sends its grant with the resolved user", async () => {
    const agent = makeAgent();
    const identifyUser = vi
      .fn()
      .mockResolvedValue({ id: "user-42", name: "Forty Two" });
    const access = vi.fn().mockReturnValue({
      user: "read",
      project: "read-write",
    });
    const runRequest = request();
    const result = await attachIntelligenceEnterpriseLearning({
      runtime: makeRuntime({
        intelligence: makeIntelligenceStub({
          ɵisEnterpriseLearningEnabled: () => false,
        }),
        identifyUser,
        memory: { access },
      }),
      request: runRequest,
      agent,
    });

    expect(result).toBeUndefined();
    expect(identifyUser).toHaveBeenCalledTimes(1);
    expect(access).toHaveBeenCalledWith({
      request: runRequest,
      user: { id: "user-42", name: "Forty Two" },
      consumer: "agent",
    });
    const [servers] = mcpMiddlewareCalls[0] as [
      Array<{ headers: Record<string, string> }>,
    ];
    expect(servers[0]?.headers).toMatchObject({
      [INTELLIGENCE_USER_ID_HEADER]: "user-42",
      [INTELLIGENCE_MEMORY_GRANT_HEADER]: JSON.stringify({
        user: "read",
        project: "read-write",
      }),
    });
  });

  /**
   * A Memory policy that grants nothing switches Memory OFF for this run. It
   * does not refuse the run: `memory.access` is a Memory policy, and a runtime
   * that wants to reject the request has `beforeRequestMiddleware`. Refusing
   * here left a tenant with Memory disabled unable to hold a conversation at
   * all, and the failure surfaced only as a bare run error.
   *
   * Both spellings of "nothing" behave identically, because they are one
   * outcome and not two states — mirroring `hasMemoryAccess` in
   * @copilotkit/channels-core, where both scopes are optional and default to
   * `"none"`, so all-none is what you get by writing nothing.
   */
  it("runs without Memory tools given a null grant", async () => {
    const agent = makeAgent();
    const result = await attachIntelligenceEnterpriseLearning({
      runtime: makeRuntime({
        intelligence: makeIntelligenceStub(),
        identifyUser: async () => ({ id: "u1", name: "User" }),
        memory: { access: () => null },
      }),
      request: request(),
      agent,
    });

    expect(result).toBeUndefined();
    expect(agent.use).not.toHaveBeenCalled();
  });

  it("runs without Memory tools given an explicit all-none grant", async () => {
    const agent = makeAgent();
    const result = await attachIntelligenceEnterpriseLearning({
      runtime: makeRuntime({
        intelligence: makeIntelligenceStub(),
        identifyUser: async () => ({ id: "u1", name: "User" }),
        memory: { access: () => ({ user: "none", project: "none" }) },
      }),
      request: request(),
      agent,
    });

    expect(result).toBeUndefined();
    expect(agent.use).not.toHaveBeenCalled();
  });

  /**
   * The narrowest grant that still asks for something must NOT be swept up by
   * the skip above — read-only user Memory is a real posture (recall what is
   * already known, record nothing new), and silently dropping its tools would
   * turn a supported configuration into no Memory at all.
   */
  it("still attaches when only one scope is granted read access", async () => {
    const agent = makeAgent();
    const result = await attachIntelligenceEnterpriseLearning({
      runtime: makeRuntime({
        intelligence: makeIntelligenceStub(),
        identifyUser: async () => ({ id: "u1", name: "User" }),
        memory: { access: () => ({ user: "read", project: "none" }) },
      }),
      request: request(),
      agent,
    });

    expect(result).toBeUndefined();
    expect(agent.use).toHaveBeenCalled();
    const [servers] = mcpMiddlewareCalls.at(-1) as [
      Array<{ headers: Record<string, string> }>,
    ];
    expect(servers[0]?.headers).toMatchObject({
      [INTELLIGENCE_MEMORY_GRANT_HEADER]: JSON.stringify({
        user: "read",
        project: "none",
      }),
    });
  });

  it("still fails the run when the policy itself is broken", async () => {
    const agent = makeAgent();
    const result = await attachIntelligenceEnterpriseLearning({
      runtime: makeRuntime({
        intelligence: makeIntelligenceStub(),
        identifyUser: async () => ({ id: "u1", name: "User" }),
        memory: {
          access: () => {
            throw new Error("policy exploded");
          },
        },
      }),
      request: request(),
      agent,
    });

    expect(result).toBeInstanceOf(Response);
    expect((result as Response).status).toBe(500);
    expect(agent.use).not.toHaveBeenCalled();
  });

  it("skips silently when identifyUser returns an invalid user", async () => {
    const agent = makeAgent();
    await attachIntelligenceEnterpriseLearning({
      runtime: makeRuntime({
        intelligence: makeIntelligenceStub(),
        // Empty id triggers the validation Response inside resolveIntelligenceUser.
        identifyUser: async () => ({ id: "", name: "x" }),
      }),
      request: request(),
      agent,
    });
    expect(agent.use).not.toHaveBeenCalled();
  });

  it("warns and does not attach when the agent does not expose a use() method", async () => {
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => undefined);
    const agent = {} as AbstractAgent; // no `use`
    await attachIntelligenceEnterpriseLearning({
      runtime: makeRuntime({
        intelligence: makeIntelligenceStub(),
        identifyUser: async () => ({ id: "u1", name: "User" }),
      }),
      request: request(),
      agent,
    });
    expect(mcpMiddlewareCalls).toHaveLength(0);
    // The operator opted into the feature, so the no-op must be surfaced.
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
  });
});
