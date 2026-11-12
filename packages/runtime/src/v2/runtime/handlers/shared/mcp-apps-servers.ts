import type { McpAppsServerConfig } from "../../core/runtime";
import { describeEndpoint } from "../../../../v1-deprecated/lib/runtime/mcp-client-cache";

const POLICY_KEYS = ["includeTools", "excludeTools"] as const;

/** Server config after `agentId` scoping. Tool lists stay on the object. */
export type ResolvedMcpAppsServer = Omit<McpAppsServerConfig, "agentId">;

/**
 * Select the servers for an agent. Tool lists must be arrays of non-empty
 * names; an empty `includeTools` array is valid and exposes no tools.
 * Invalid lists are reported for every server, including ones another agent owns.
 */
export function resolveMcpAppsServers(
  servers: readonly McpAppsServerConfig[],
  agentId: string,
): ResolvedMcpAppsServer[] {
  const violations: string[] = [];

  for (const [index, server] of servers.entries()) {
    const config = server as unknown as Record<string, unknown>;
    const label = server.serverId ?? describeEndpoint(server.url);
    for (const key of POLICY_KEYS) {
      if (
        !Object.prototype.hasOwnProperty.call(config, key) ||
        config[key] === undefined
      ) {
        continue;
      }
      if (!isToolNameList(config[key])) {
        violations.push(
          `${key} at server[${index}] (${label}) must be an array of non-empty tool names`,
        );
      }
    }
  }

  if (violations.length > 0) {
    throw new Error(`Invalid MCP Apps tool policy: ${violations.join(", ")}.`);
  }

  return servers
    .filter((server) => !server.agentId || server.agentId === agentId)
    .map(({ agentId: _agentId, ...server }) => server);
}

function isToolNameList(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.every((name) => typeof name === "string" && name.length > 0)
  );
}
