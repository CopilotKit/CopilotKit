import { randomUUID } from "node:crypto";
import { EventType } from "@ag-ui/client";
import type { AbstractAgent, BaseEvent, RunAgentInput } from "@ag-ui/client";
import { MCPAppsMiddleware } from "@ag-ui/mcp-apps-middleware";
import type {
  MCPAppsMiddlewareConfig,
  MCPClientConfig,
} from "@ag-ui/mcp-apps-middleware";
import { Observable } from "rxjs";
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

type ListedTool = { tool?: { name?: string } };

interface McpAppsPolicyTarget {
  fetchToolsFromServer?: (
    serverConfig: MCPClientConfig,
  ) => Promise<ListedTool[]>;
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
  run?: (input: RunAgentInput, next: AbstractAgent) => Observable<BaseEvent>;
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
  const hiddenToolNames = new Set<string>();
  const discovered = new Map<string, Promise<ListedTool[]>>();

  const loadTools = (serverConfig: MCPClientConfig): Promise<ListedTool[]> => {
    const key = mcpAppsServerPolicyKey(serverConfig);
    const cached = discovered.get(key);
    if (cached) return cached;
    const task = (async () => {
      const policy = policies.get(key);
      // An empty allowlist exposes nothing, so do not open the server.
      if (policy?.includeTools?.length === 0) return [];
      const tools = await originalFetch(serverConfig);
      if (!policy) return tools;
      return tools.filter((entry) => {
        const name = entry?.tool?.name;
        if (typeof name !== "string") return false;
        if (!isMcpAppToolAllowed(name, policy)) {
          hiddenToolNames.add(name);
          return false;
        }
        return true;
      });
    })();
    discovered.set(key, task);
    return task;
  };

  target.fetchToolsFromServer = loadTools;

  const originalExecute = target.executeMCPRequest.bind(middleware);
  target.executeMCPRequest = async (serverConfig, method, params) => {
    if (method === "tools/call") {
      const tools = await loadTools(serverConfig);
      const name = params?.name;
      const allowed =
        typeof name === "string" &&
        tools.some((entry) => entry?.tool?.name === name);
      if (!allowed) return deniedToolResult(name);
    }
    return originalExecute(serverConfig, method, params);
  };

  rejectHiddenToolCalls(target, hiddenToolNames);

  if (typeof target.executeToolCall === "function") {
    const originalCall = target.executeToolCall.bind(middleware);
    target.executeToolCall = async (serverConfig, toolName, args) => {
      assertMcpAppToolAllowed(serverConfig, toolName, policies);
      return originalCall(serverConfig, toolName, args);
    };
  }
}

function deniedToolResult(toolName: unknown): {
  content: Array<{ type: "text"; text: string }>;
  isError: true;
} {
  const suffix = typeof toolName === "string" ? `: ${toolName}` : "";
  return {
    content: [{ type: "text", text: `MCP tool is not allowed${suffix}` }],
    isError: true,
  };
}

/**
 * A filtered-out MCP tool call must still be answered. The middleware drops it
 * from the execution map, so the client would otherwise keep an open call.
 */
function rejectHiddenToolCalls(
  target: McpAppsPolicyTarget,
  hiddenToolNames: Set<string>,
): void {
  if (typeof target.run !== "function") return;
  const originalRun = target.run.bind(target);
  target.run = (input, next) =>
    new Observable((subscriber) => {
      const pending = new Map<string, string>();
      const subscription = originalRun(input, next).subscribe({
        next: (event) => {
          const record = event as BaseEvent & {
            toolCallId?: string;
            toolCallName?: string;
          };
          if (
            record.type === EventType.TOOL_CALL_START &&
            record.toolCallId &&
            record.toolCallName &&
            hiddenToolNames.has(record.toolCallName)
          ) {
            pending.set(record.toolCallId, record.toolCallName);
          }
          if (record.type === EventType.TOOL_CALL_RESULT && record.toolCallId) {
            pending.delete(record.toolCallId);
          }
          if (record.type === EventType.RUN_FINISHED) {
            for (const [toolCallId, name] of pending) {
              subscriber.next({
                type: EventType.TOOL_CALL_RESULT,
                messageId: randomUUID(),
                toolCallId,
                content: `MCP tool is not allowed: ${name}`,
              } as BaseEvent);
            }
            pending.clear();
          }
          subscriber.next(event);
        },
        error: (error) => subscriber.error(error),
        complete: () => subscriber.complete(),
      });
      return () => subscription.unsubscribe();
    });
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
