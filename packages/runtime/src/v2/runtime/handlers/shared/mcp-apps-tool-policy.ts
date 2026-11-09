import { MCPAppsMiddleware } from "@ag-ui/mcp-apps-middleware";
import type {
  MCPAppsMiddlewareConfig,
  MCPClientConfig,
} from "@ag-ui/mcp-apps-middleware";
import type { ResolvedMcpAppsServer } from "./mcp-apps-servers";

/**
 * Name lists for one MCP Apps server.
 *
 * `includeTools`, when set, is the allowlist (an empty list allows nothing).
 * `excludeTools` is applied after that allowlist, so a name in both is excluded.
 * Names are the MCP `tools/list` names, before any host prefix.
 */
export interface McpAppToolPolicy {
  includeTools?: readonly string[];
  excludeTools?: readonly string[];
}

interface McpAppsPolicyTarget {
  fetchToolsFromServer?: (
    serverConfig: MCPClientConfig,
  ) => Promise<Array<{ tool?: { name?: string } }>>;
  executeMCPRequest?: (
    serverConfig: MCPClientConfig,
    method: string,
    params?: Record<string, unknown>,
  ) => Promise<unknown>;
  executeToolCall?: (
    serverConfig: MCPClientConfig,
    toolName: string,
    args: Record<string, unknown>,
  ) => Promise<unknown>;
}

const POLICY_ENFORCEMENT_ERROR =
  "Cannot enforce MCP Apps includeTools/excludeTools against this " +
  "@ag-ui/mcp-apps-middleware build. The runtime refused to attach the server " +
  "rather than expose every tool. See " +
  "https://github.com/CopilotKit/CopilotKit/issues/5930.";

/** Stable identity for a server config, including a shallow copy of it. */
export function mcpAppsServerPolicyKey(server: {
  type: string;
  url: string;
  serverId?: string;
}): string {
  return `${server.serverId ?? ""}\n${server.type}\n${server.url}`;
}

/** Whether one discovered tool name survives the server's include/exclude lists. */
export function isMcpAppToolAllowed(
  toolName: string,
  policy: McpAppToolPolicy,
): boolean {
  if (
    policy.includeTools !== undefined &&
    !policy.includeTools.includes(toolName)
  ) {
    return false;
  }
  if (policy.excludeTools?.includes(toolName)) return false;
  return true;
}

/**
 * Keep discovery and both execution paths on the same predicate.
 *
 * `@ag-ui/mcp-apps-middleware` owns the MCP transport. It builds the tool map
 * passed to the model from `fetchToolsFromServer`, executes that map for
 * model-emitted calls, and serves iframe `tools/call` from `executeMCPRequest`.
 * Filtering only the run input would hide a tool from the model and still leave
 * it callable. If a build drops those gates, refuse the policy.
 */
export function enforceMcpAppsToolPolicy(
  middleware: object,
  policies: ReadonlyMap<string, McpAppToolPolicy>,
): void {
  if (policies.size === 0) return;

  const target = middleware as McpAppsPolicyTarget;
  if (
    typeof target.fetchToolsFromServer !== "function" ||
    typeof target.executeMCPRequest !== "function"
  ) {
    throw new Error(POLICY_ENFORCEMENT_ERROR);
  }

  const originalFetch = target.fetchToolsFromServer.bind(middleware);
  target.fetchToolsFromServer = async (serverConfig) => {
    const tools = await originalFetch(serverConfig);
    const policy = policies.get(mcpAppsServerPolicyKey(serverConfig));
    if (!policy) return tools;
    return tools.filter((entry) => {
      const name = entry?.tool?.name;
      return typeof name === "string" && isMcpAppToolAllowed(name, policy);
    });
  };

  const originalExecute = target.executeMCPRequest.bind(middleware);
  target.executeMCPRequest = async (serverConfig, method, params) => {
    if (method === "tools/call") {
      assertMcpAppToolAllowed(serverConfig, params?.name, policies);
    }
    return originalExecute(serverConfig, method, params);
  };

  if (typeof target.executeToolCall === "function") {
    const originalCall = target.executeToolCall.bind(middleware);
    target.executeToolCall = async (serverConfig, toolName, args) => {
      assertMcpAppToolAllowed(serverConfig, toolName, policies);
      return originalCall(serverConfig, toolName, args);
    };
  }
}

function assertMcpAppToolAllowed(
  serverConfig: MCPClientConfig,
  toolName: unknown,
  policies: ReadonlyMap<string, McpAppToolPolicy>,
): void {
  const policy = policies.get(mcpAppsServerPolicyKey(serverConfig));
  if (!policy) return;
  if (typeof toolName !== "string" || !isMcpAppToolAllowed(toolName, policy)) {
    const suffix = typeof toolName === "string" ? `: ${toolName}` : "";
    throw new Error(`MCP tool is not allowed${suffix}`);
  }
}

function policyFor(
  includeTools: readonly string[] | undefined,
  excludeTools: readonly string[] | undefined,
): McpAppToolPolicy | undefined {
  if (includeTools === undefined && excludeTools === undefined)
    return undefined;
  const policy: McpAppToolPolicy = {};
  if (includeTools !== undefined) policy.includeTools = includeTools;
  if (excludeTools !== undefined) policy.excludeTools = excludeTools;
  return policy;
}

/** Build MCP Apps middleware with per-server tool lists applied, if any. */
export function createMcpAppsMiddleware(options: {
  mcpServers: readonly ResolvedMcpAppsServer[];
  discoveryFailureMode?: MCPAppsMiddlewareConfig["discoveryFailureMode"];
}): MCPAppsMiddleware {
  const policies = new Map<string, McpAppToolPolicy>();
  const mcpServers: MCPClientConfig[] = [];

  for (const server of options.mcpServers) {
    const { includeTools, excludeTools, ...config } = server;
    mcpServers.push(config);
    const policy = policyFor(includeTools, excludeTools);
    if (policy) policies.set(mcpAppsServerPolicyKey(config), policy);
  }

  const middleware = new MCPAppsMiddleware(
    options.discoveryFailureMode
      ? { mcpServers, discoveryFailureMode: options.discoveryFailureMode }
      : { mcpServers },
  );
  enforceMcpAppsToolPolicy(middleware, policies);
  return middleware;
}
