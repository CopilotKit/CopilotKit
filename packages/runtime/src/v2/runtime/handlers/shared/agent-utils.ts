import type { AbstractAgent, RunAgentInput } from "@ag-ui/client";
import { RunAgentInputSchema } from "@ag-ui/client";
import { A2UIMiddleware } from "@ag-ui/a2ui-middleware";
import { MCPAppsMiddleware } from "@ag-ui/mcp-apps-middleware";
import type {
  MCPClientConfig,
  MCPClientConfigHTTP,
  MCPServersConfig,
} from "../../../../agent";
import type { CopilotRuntimeLike } from "../../core/runtime";
import { resolveAgents } from "../../core/runtime";
import { INTELLIGENCE_USER_ID_HEADER } from "../../intelligence-platform/client";
import { OpenGenerativeUIMiddleware } from "../../open-generative-ui-middleware";
import { extractForwardableHeaders } from "../header-utils";
import { logger } from "@copilotkit/shared";

type MiddlewareCapableAgent = AbstractAgent & {
  use?: (middleware: unknown) => void;
  headers?: Record<string, string>;
  /** Side channel exposed by `BuiltInAgent` for runtime-injected MCP servers. */
  runtimeMcpServers?: MCPServersConfig;
};

export interface RunAgentParameters {
  request: Request;
  runtime: CopilotRuntimeLike;
  agentId: string;
}

export interface ConnectRequestBody extends RunAgentInput {
  lastSeenEventId?: string | null;
}

export async function cloneAgentForRequest(
  runtime: CopilotRuntimeLike,
  agentId: string,
  request?: Request,
): Promise<AbstractAgent | Response> {
  const agents = await resolveAgents(runtime.agents, request);

  if (!agents[agentId]) {
    return new Response(
      JSON.stringify({
        error: "Agent not found",
        message: `Agent '${agentId}' does not exist`,
      }),
      {
        status: 404,
        headers: { "Content-Type": "application/json" },
      },
    );
  }

  return (agents[agentId] as AbstractAgent).clone() as AbstractAgent;
}

export function configureAgentForRequest(params: {
  runtime: CopilotRuntimeLike;
  request: Request;
  agentId: string;
  agent: AbstractAgent;
}): void {
  const { runtime, request, agentId } = params;
  const agent = params.agent as MiddlewareCapableAgent;

  if (runtime.a2ui) {
    const { agents: targetAgents, ...a2uiOptions } = runtime.a2ui;
    const shouldApply = !targetAgents || targetAgents.includes(agentId);
    if (shouldApply && typeof agent.use === "function") {
      agent.use(new A2UIMiddleware(a2uiOptions));
    }
  }

  if (runtime.mcpApps?.servers?.length) {
    const mcpServers = runtime.mcpApps.servers
      .filter((server) => !server.agentId || server.agentId === agentId)
      .map((server) => {
        const mcpServer = { ...server };
        delete mcpServer.agentId;
        return mcpServer;
      });

    if (mcpServers.length > 0 && typeof agent.use === "function") {
      agent.use(new MCPAppsMiddleware({ mcpServers }));
    }
  }

  if (runtime.openGenerativeUI) {
    const config = runtime.openGenerativeUI;
    const targetAgents = typeof config === "object" ? config.agents : undefined;
    const shouldApply = !targetAgents || targetAgents.includes(agentId);
    if (shouldApply && typeof agent.use === "function") {
      agent.use(new OpenGenerativeUIMiddleware());
    }
  }

  if (agent.headers) {
    agent.headers = {
      ...agent.headers,
      ...extractForwardableHeaders(request),
    };
  }

  // When the runtime is configured for Intelligence AND the Intelligence
  // client has `mcpServer: true`, auto-attach the platform's MCP server on
  // every request that has a resolved user. User identity flows through
  // `requestHeaders` like any other forwarded value — `intelligence/run.ts`
  // puts `x-cpki-user-id` onto `agent.headers` before the run starts, the
  // resolver below reads it back. We skip the auto-attach if the user has
  // already configured a server pointing at the same URL (explicit opt-in
  // wins).
  const intelligence = (runtime as { intelligence?: unknown }).intelligence as
    | {
        ɵgetApiUrl?: () => string;
        ɵgetApiKey?: () => string;
        ɵisMcpServerEnabled?: () => boolean;
      }
    | undefined;
  if (
    intelligence?.ɵisMcpServerEnabled?.() &&
    typeof intelligence.ɵgetApiUrl === "function" &&
    typeof intelligence.ɵgetApiKey === "function"
  ) {
    const intelligenceMcpUrl = `${intelligence.ɵgetApiUrl()}/mcp`;
    const intelligenceApiKey = intelligence.ɵgetApiKey();
    const intelligenceServer: MCPClientConfigHTTP = {
      type: "http",
      url: intelligenceMcpUrl,
      headers: { Authorization: `Bearer ${intelligenceApiKey}` },
      getHeaders: ({ requestHeaders }) => {
        const userId = requestHeaders[INTELLIGENCE_USER_ID_HEADER]?.trim();
        if (!userId) {
          throw new Error(
            "Intelligence MCP server: no user-id forwarded for this run. " +
              "Configure `identifyUser` on the CopilotRuntime so the agent " +
              "knows which end-user each MCP call is on behalf of.",
          );
        }
        return { [INTELLIGENCE_USER_ID_HEADER]: userId };
      },
    };
    agent.runtimeMcpServers = async (ctx) => {
      if (!ctx.requestHeaders[INTELLIGENCE_USER_ID_HEADER]?.trim()) return [];
      const userResolved = await resolveUserMcpServers(params.agent, ctx);
      if (
        userResolved.some(
          (s) => s.type === "http" && s.url === intelligenceMcpUrl,
        )
      ) {
        return [];
      }
      return [intelligenceServer];
    };
  }
}

async function resolveUserMcpServers(
  agent: AbstractAgent,
  ctx: { requestHeaders: Record<string, string>; input: RunAgentInput },
): Promise<MCPClientConfig[]> {
  const source = (agent as { config?: { mcpServers?: MCPServersConfig } })
    .config?.mcpServers;
  if (!source) return [];
  return typeof source === "function" ? source(ctx) : source;
}

export async function parseRunRequest(
  request: Request,
): Promise<RunAgentInput | Response> {
  try {
    const requestBody = await request.json();
    return RunAgentInputSchema.parse(requestBody);
  } catch (error) {
    logger.error("Invalid run request body:", error);
    return new Response(
      JSON.stringify({
        error: "Invalid request body",
        details: error instanceof Error ? error.message : String(error),
      }),
      {
        status: 400,
        headers: { "Content-Type": "application/json" },
      },
    );
  }
}

export async function parseConnectRequest(request: Request): Promise<
  | Response
  | {
      input: RunAgentInput;
      lastSeenEventId: string | null;
    }
> {
  try {
    const requestBody = await request.json();
    const input = RunAgentInputSchema.parse(requestBody);
    let lastSeenEventId: string | null = null;

    if (
      "lastSeenEventId" in (requestBody as Record<string, unknown>) &&
      (typeof (requestBody as Record<string, unknown>).lastSeenEventId ===
        "string" ||
        (requestBody as Record<string, unknown>).lastSeenEventId === null)
    ) {
      lastSeenEventId =
        (requestBody as ConnectRequestBody).lastSeenEventId ?? null;
    }

    return { input, lastSeenEventId };
  } catch (error) {
    logger.error("Invalid connect request body:", error);
    return new Response(
      JSON.stringify({
        error: "Invalid request body",
        details: error instanceof Error ? error.message : String(error),
      }),
      {
        status: 400,
        headers: { "Content-Type": "application/json" },
      },
    );
  }
}
