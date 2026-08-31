import type { MCPClientConfig } from "@ag-ui/mcp-apps-middleware";
import type { McpAppsServerConfig } from "../../core/runtime";

const UNSUPPORTED_POLICY_KEYS = ["includeTools", "excludeTools"] as const;
const MCP_APPS_MIDDLEWARE_VERSION = "@ag-ui/mcp-apps-middleware@0.0.3";
const MCP_APPS_POLICY_ISSUE =
  "https://github.com/CopilotKit/CopilotKit/issues/5930";

/**
 * Select the servers for an agent and validate the policy boundary owned by
 * the installed MCP Apps middleware.
 */
export function resolveMcpAppsServers(
  servers: readonly McpAppsServerConfig[],
  agentId: string,
): MCPClientConfig[] {
  const violations: string[] = [];

  for (const [index, server] of servers.entries()) {
    const config = server as unknown as Record<string, unknown>;
    for (const key of UNSUPPORTED_POLICY_KEYS) {
      if (
        Object.prototype.hasOwnProperty.call(config, key) &&
        config[key] !== undefined
      ) {
        violations.push(
          `${key} at server[${index}] (${server.serverId ?? server.url})`,
        );
      }
    }
  }

  if (violations.length > 0) {
    throw new Error(
      `Unsupported MCP Apps tool policy: ${violations.join(", ")}. ` +
        `${MCP_APPS_MIDDLEWARE_VERSION} owns per-server tool policy and ` +
        `does not support these keys; see ${MCP_APPS_POLICY_ISSUE}.`,
    );
  }

  return servers
    .filter((server) => !server.agentId || server.agentId === agentId)
    .map(({ agentId: _agentId, ...server }) => server as MCPClientConfig);
}
