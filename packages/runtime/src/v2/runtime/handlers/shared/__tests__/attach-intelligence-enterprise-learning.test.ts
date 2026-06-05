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
