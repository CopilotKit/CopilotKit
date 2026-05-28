import type { AbstractAgent, RunAgentInput } from "@ag-ui/client";
import { RunAgentInputSchema } from "@ag-ui/client";
import { A2UIMiddleware } from "@ag-ui/a2ui-middleware";
import { MCPAppsMiddleware } from "@ag-ui/mcp-apps-middleware";
import { MCPMiddleware } from "@ag-ui/mcp-middleware";
import type { CopilotRuntimeLike } from "../../core/runtime";
import { isIntelligenceRuntime, resolveAgents } from "../../core/runtime";
import { OpenGenerativeUIMiddleware } from "../../open-generative-ui-middleware";
import { INTELLIGENCE_USER_ID_HEADER } from "../../intelligence-platform/client";
import { extractForwardableHeaders } from "../header-utils";
import { resolveIntelligenceUser } from "./resolve-intelligence-user";
import { logger } from "@copilotkit/shared";

type MiddlewareCapableAgent = AbstractAgent & {
  use?: (middleware: unknown) => void;
  headers?: Record<string, string>;
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

export async function configureAgentForRequest(params: {
  runtime: CopilotRuntimeLike;
  request: Request;
  agentId: string;
  agent: AbstractAgent;
}): Promise<void> {
  const { runtime, request, agentId } = params;
  const agent = params.agent as MiddlewareCapableAgent;

  // When CopilotKit Intelligence is configured with `mcpServer: true`,
  // attach the @ag-ui/mcp-middleware so every agent run gets the
  // platform's MCP tools — uniformly across frameworks, not just for
  // BuiltInAgent. The headers carry per-request auth (Bearer apiKey +
  // user-id); the middleware is on a per-request agent clone so these
  // are effectively per-request even though the config is "static".
  // If user resolution fails (Response), we skip attaching — the
  // intelligence run handler will reject the request with the same error.
  if (
    isIntelligenceRuntime(runtime) &&
    runtime.intelligence?.ɵisMcpServerEnabled?.() &&
    typeof agent.use === "function"
  ) {
    const userResult = await resolveIntelligenceUser({ runtime, request });
    if (!(userResult instanceof Response)) {
      agent.use(
        new MCPMiddleware([
          {
            type: "http",
            url: `${runtime.intelligence.ɵgetApiUrl()}/mcp`,
            serverId: "intelligence",
            headers: {
              Authorization: `Bearer ${runtime.intelligence.ɵgetApiKey()}`,
              [INTELLIGENCE_USER_ID_HEADER]: userResult.id,
            },
          },
        ]),
      );
    }
  }

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
