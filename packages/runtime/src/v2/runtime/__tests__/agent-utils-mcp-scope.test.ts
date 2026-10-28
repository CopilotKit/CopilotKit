import { HttpAgent } from "@ag-ui/client";
import { MCPAppsMiddleware } from "@ag-ui/mcp-apps-middleware";
import type * as MCPAppsMiddlewareModule from "@ag-ui/mcp-apps-middleware";
import { expect, test, vi } from "vitest";
import { CopilotIntelligenceRuntime } from "../core/runtime";
import { CopilotKitIntelligence } from "../intelligence-platform/client";
import { configureAgentForRequest } from "../handlers/shared/agent-utils";

const middlewareConstructor = vi.hoisted(() => vi.fn());
vi.mock("@ag-ui/mcp-apps-middleware", async (importOriginal) => {
  const actual = await importOriginal<typeof MCPAppsMiddlewareModule>();
  class TrackedMiddleware extends actual.MCPAppsMiddleware {
    constructor(
      ...args: ConstructorParameters<typeof actual.MCPAppsMiddleware>
    ) {
      middlewareConstructor(...args);
      super(...args);
    }
  }
  return { ...actual, MCPAppsMiddleware: TrackedMiddleware };
});

/** Configure an agent without making platform or MCP requests. */
function setup(scopedElsewhere: boolean, nativeHistoryAgents?: string[]) {
  const agent = new HttpAgent({ url: "http://localhost:9999/agent" });
  const runtime = new CopilotIntelligenceRuntime({
    intelligence: new CopilotKitIntelligence({ apiKey: "fixture-key" }),
    identifyUser: () => ({ id: "alice", name: "Alice" }),
    agents: { default: agent },
    generateThreadNames: false,
    nativeHistoryAgents,
    mcpApps: {
      servers: scopedElsewhere
        ? [
            {
              type: "http",
              url: "http://localhost:9999/mcp",
              agentId: "another-agent",
            },
          ]
        : [],
    },
  });
  return {
    use: vi.spyOn(agent, "use"),
    params: {
      runtime,
      agent,
      agentId: "default",
      request: new Request("http://localhost/run"),
    },
  };
}

test.each([false, true])(
  "ordinary runs add no MCP middleware when no server is selected (scoped=%s)",
  (scoped) => {
    const { use, params } = setup(scoped);
    configureAgentForRequest(params);
    expect(use).not.toHaveBeenCalled();
  },
);

test("an MCP proxy request retains the upstream empty-server guard", () => {
  const { use, params } = setup(true);
  const proxyParams = { ...params, isMcpProxyRequest: true };
  configureAgentForRequest(proxyParams);
  expect(use).toHaveBeenCalledExactlyOnceWith(expect.any(MCPAppsMiddleware));
});

test.each([
  { nativeHistoryAgents: ["default"], expected: "tool-results" },
  { nativeHistoryAgents: ["other"], expected: "full-history" },
  { nativeHistoryAgents: undefined, expected: "full-history" },
])(
  "only trusted native registration selects $expected continuation",
  ({ nativeHistoryAgents, expected }) => {
    middlewareConstructor.mockClear();
    const { params, use } = setup(false, nativeHistoryAgents);
    params.runtime.mcpApps = {
      servers: [{ type: "http", url: "http://localhost:9999/mcp" }],
    };
    params.runtime.a2ui = {
      actionTransport: "user-message",
      agents: ["default"],
    };
    params.request = new Request("http://localhost/run", {
      method: "POST",
      body: JSON.stringify({
        forwardedProps: {
          nativeHistoryAgents: ["default"],
          continuationInput: "tool-results",
        },
      }),
    });
    configureAgentForRequest(params);
    expect(use).toHaveBeenCalledTimes(2);
    expect(middlewareConstructor).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        discoveryFailureMode: "throw",
        continuationInput: expected,
      }),
    );
  },
);
