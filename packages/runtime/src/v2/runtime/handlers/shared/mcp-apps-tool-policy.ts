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

type ListedTool = { tool?: { name?: string }; originalName?: string };

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
  const exposedNames = new Set<string>();
  const exposedToOriginal = new Map<string, string>();
  const usedNames = new Set<string>();
  const discovered = new Map<string, Promise<ListedTool[]>>();
  const emptyAllowlist = [...policies.values()].some(
    (policy) => policy.includeTools?.length === 0,
  );

  const loadTools = (serverConfig: MCPClientConfig): Promise<ListedTool[]> => {
    const key = mcpAppsServerPolicyKey(serverConfig);
    const cached = discovered.get(key);
    if (cached) return cached;
    const task = (async () => {
      const policy = policies.get(key);
      // An empty allowlist exposes nothing, so do not list tools.
      if (policy?.includeTools?.length === 0) return [];
      const tools = await originalFetch(serverConfig);
      const visible: ListedTool[] = [];
      for (const entry of tools) {
        const name = entry?.tool?.name;
        if (typeof name !== "string") continue;
        if (policy && !isMcpAppToolAllowed(name, policy)) {
          hiddenToolNames.add(name);
          continue;
        }
        const exposed = exposeToolName(name, serverConfig, usedNames);
        exposedNames.add(exposed);
        if (exposed !== name) exposedToOriginal.set(exposed, name);
        visible.push(
          exposed === name
            ? { ...entry, originalName: name }
            : {
                ...entry,
                originalName: name,
                tool: { ...entry.tool, name: exposed },
              },
        );
      }
      return visible;
    })().catch((error: unknown) => {
      if (discovered.get(key) === task) discovered.delete(key);
      throw error;
    });
    discovered.set(key, task);
    return task;
  };

  target.fetchToolsFromServer = loadTools;

  const originalExecute = target.executeMCPRequest.bind(middleware);
  target.executeMCPRequest = async (serverConfig, method, params) => {
    if (
      method === "tools/call" &&
      policies.has(mcpAppsServerPolicyKey(serverConfig))
    ) {
      const tools = await loadTools(serverConfig);
      const name = params?.name;
      const allowed =
        typeof name === "string" &&
        tools.some(
          (entry) => (entry.originalName ?? entry.tool?.name) === name,
        );
      if (!allowed) return deniedToolResult(name);
    }
    return originalExecute(serverConfig, method, params);
  };

  rejectHiddenToolCalls(target, {
    hiddenToolNames,
    exposedNames,
    emptyAllowlist,
    usedNames,
  });

  if (typeof target.executeToolCall === "function") {
    const originalCall = target.executeToolCall.bind(middleware);
    target.executeToolCall = async (serverConfig, toolName, args) => {
      const originalName = exposedToOriginal.get(toolName) ?? toolName;
      assertMcpAppToolAllowed(serverConfig, originalName, policies);
      return originalCall(serverConfig, originalName, args);
    };
  }
}

const TOOL_NAME_LIMIT = 64;
const SAFE_TOOL_NAME = /^[A-Za-z0-9_-]+$/;

/** OpenAI-compatible tool name: ASCII letters, digits, underscore, hyphen, at most 64 characters. */
export function isProviderSafeToolName(name: string): boolean {
  return (
    name.length > 0 &&
    name.length <= TOOL_NAME_LIMIT &&
    SAFE_TOOL_NAME.test(name)
  );
}

function sanitizeToolToken(value: string): string {
  const cleaned = value
    .replace(/[^A-Za-z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return cleaned.length > 0 ? cleaned : "mcp";
}

function fitToolName(suffix: string, tool: string, tail: string): string {
  const room = Math.max(2, TOOL_NAME_LIMIT - 2 - tail.length);
  let suffixLength = Math.min(suffix.length, Math.max(1, Math.floor(room / 2)));
  let toolLength = Math.min(tool.length, room - suffixLength);
  if (toolLength < 1) {
    toolLength = 1;
    suffixLength = room - 1;
  }
  return `${suffix.slice(0, suffixLength)}__${tool.slice(0, toolLength)}${tail}`;
}

/** A colliding or unsafe name is rewritten so the provider accepts it and the original call name is preserved. */
function exposeToolName(
  original: string,
  server: MCPClientConfig,
  used: Set<string>,
): string {
  if (isProviderSafeToolName(original) && !used.has(original)) {
    used.add(original);
    return original;
  }
  const suffix = sanitizeToolToken(server.serverId || "mcp");
  const tool = sanitizeToolToken(original);
  let discriminator = 2;
  let candidate = fitToolName(suffix, tool, "");
  while (used.has(candidate) || !isProviderSafeToolName(candidate)) {
    candidate = fitToolName(suffix, tool, `_${discriminator++}`);
  }
  used.add(candidate);
  return candidate;
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
  names: {
    hiddenToolNames: Set<string>;
    exposedNames: Set<string>;
    emptyAllowlist: boolean;
    usedNames: Set<string>;
  },
): void {
  if (typeof target.run !== "function") return;
  const originalRun = target.run.bind(target);
  target.run = (input, next) => {
    for (const tool of input.tools) names.usedNames.add(tool.name);
    return new Observable((subscriber) => {
      const frontendTools = new Set(input.tools.map((tool) => tool.name));
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
            !frontendTools.has(record.toolCallName) &&
            (names.hiddenToolNames.has(record.toolCallName) ||
              (names.emptyAllowlist &&
                !names.exposedNames.has(record.toolCallName)))
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
  };
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
