import { HttpAgent } from "@ag-ui/client";
import { MCPAppsMiddleware } from "@ag-ui/mcp-apps-middleware";
import { expect, test, vi } from "vitest";
import { CopilotIntelligenceRuntime } from "../core/runtime";
import { CopilotKitIntelligence } from "../intelligence-platform/client";
import { configureAgentForRequest } from "../handlers/shared/agent-utils";

/** Configure an agent without making platform or MCP requests. */
function setup(scopedElsewhere: boolean) {
  const agent = new HttpAgent({ url: "http://localhost:9999/agent" });
  const runtime = new CopilotIntelligenceRuntime({
    intelligence: new CopilotKitIntelligence({ apiKey: "fixture-key" }),
    identifyUser: () => ({ id: "alice", name: "Alice" }),
    agents: { default: agent },
    generateThreadNames: false,
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
