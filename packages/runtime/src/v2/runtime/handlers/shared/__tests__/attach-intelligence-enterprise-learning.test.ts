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
  it.each([
    ["a null grant", () => null],
    ["an explicit all-none grant", () => ({ user: "none", project: "none" })],
  ])("runs without Memory tools given %s", async (_label, access) => {
    const agent = makeAgent();
    const result = await attachIntelligenceEnterpriseLearning({
      runtime: makeRuntime({
        intelligence: makeIntelligenceStub({
          ɵisEnterpriseLearningEnabled: () => false,
        }),
        identifyUser: async () => ({ id: "u1", name: "User" }),
        memory: { access } as CopilotRuntimeLike["memory"],
      }),
      request: request(),
      agent,
    });

    expect(result).toBeUndefined();
    expect(agent.use).not.toHaveBeenCalled();
  });

  /**
   * Enterprise learning and Memory ride the SAME MCP server, so skipping the
   * attachment to express "no Memory" would take the learning tools with it —
   * an operator who turned learning on would silently lose it for any tenant
   * whose Memory policy grants nothing.
   *
   * Attaching is safe because the grant travels in the header and Intelligence
   * registers one Memory tool per granted scope: an all-none grant registers
   * none, and leaves the knowledge-base tool untouched. The runtime decides
   * whether to connect; the service decides which tools come back.
   */
  it.each([
    ["a null grant", () => null],
    ["an explicit all-none grant", () => ({ user: "none", project: "none" })],
  ])(
    "still attaches for enterprise learning given %s",
    async (_label, access) => {
      const agent = makeAgent();
      const result = await attachIntelligenceEnterpriseLearning({
        runtime: makeRuntime({
          intelligence: makeIntelligenceStub(),
          identifyUser: async () => ({ id: "u1", name: "User" }),
          memory: { access } as CopilotRuntimeLike["memory"],
        }),
        request: request(),
        agent,
      });

      expect(result).toBeUndefined();
      expect(agent.use).toHaveBeenCalledTimes(1);
      const [servers] = mcpMiddlewareCalls.at(-1) as [
        Array<{ headers: Record<string, string> }>,
      ];
      // The all-none grant is sent, not omitted: omitting it would read as
      // "this caller configured no Memory policy" and hand back full access.
      expect(servers[0]?.headers).toMatchObject({
        [INTELLIGENCE_MEMORY_GRANT_HEADER]: JSON.stringify({
          user: "none",
          project: "none",
        }),
      });
    },
  );

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

  /**
   * The middleware-capability check has to run AFTER the grant resolves, or it
   * reinstates the very bug this fix removes on a narrower path: a tenant whose
   * Memory is switched off would still lose the whole run, just because their
   * agent framework happens not to take middleware.
   *
   * Channels reads it the same way — it raises its unsupported-agent error only
   * once a grant has resolved to something deliverable.
   */
  it("warns rather than failing when a middleware-less agent is granted no Memory", async () => {
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => undefined);
    const agent = {} as AbstractAgent; // no `use`
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
    expect(mcpMiddlewareCalls).toHaveLength(0);
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
  });

  /**
   * The counterpart: Memory that IS granted and cannot be delivered is a
   * genuine misconfiguration, and still fails loudly.
   */
  it("fails the run when a middleware-less agent is granted Memory", async () => {
    const agent = {} as AbstractAgent; // no `use`
    const result = await attachIntelligenceEnterpriseLearning({
      runtime: makeRuntime({
        intelligence: makeIntelligenceStub({
          ɵisEnterpriseLearningEnabled: () => false,
        }),
        identifyUser: async () => ({ id: "u1", name: "User" }),
        memory: { access: () => ({ user: "read", project: "none" }) },
      }),
      request: request(),
      agent,
    });

    expect(result).toBeInstanceOf(Response);
    expect((result as Response).status).toBe(500);
    expect(mcpMiddlewareCalls).toHaveLength(0);
  });

  /**
   * `memory.access` is typed `MemoryGrant | null`, so a policy that returns
   * nothing at all is broken rather than restrictive. Reading a missing return
   * as "grant nothing" would switch Memory off silently; it fails loudly, the
   * same as a policy that throws or names an access level that does not exist.
   */
  it("fails the run when the policy returns undefined", async () => {
    const agent = makeAgent();
    const result = await attachIntelligenceEnterpriseLearning({
      runtime: makeRuntime({
        intelligence: makeIntelligenceStub(),
        identifyUser: async () => ({ id: "u1", name: "User" }),
        memory: {
          access: (() => undefined) as unknown as NonNullable<
            CopilotRuntimeLike["memory"]
          >["access"],
        },
      }),
      request: request(),
      agent,
    });

    expect(result).toBeInstanceOf(Response);
    expect((result as Response).status).toBe(500);
    expect(agent.use).not.toHaveBeenCalled();
  });
});
