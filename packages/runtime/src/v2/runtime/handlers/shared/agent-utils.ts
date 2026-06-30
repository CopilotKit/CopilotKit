import type { AbstractAgent, RunAgentInput } from "@ag-ui/client";
import { RunAgentInputSchema } from "@ag-ui/client";
import { A2UIMiddleware } from "@ag-ui/a2ui-middleware";
import { MCPAppsMiddleware } from "@ag-ui/mcp-apps-middleware";
import { MCPMiddleware } from "@ag-ui/mcp-middleware";
import type { CopilotRuntimeLike } from "../../core/runtime";
import {
  isA2UIEnabled,
  isIntelligenceRuntime,
  resolveAgents,
} from "../../core/runtime";
import { OpenGenerativeUIMiddleware } from "../../open-generative-ui-middleware";
import { INTELLIGENCE_USER_ID_HEADER } from "../../intelligence-platform/client";
import {
  mergeForwardableHeaders,
  resolveForwardHeadersPolicy,
} from "../header-utils";
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

/**
 * Resolve `agentId` against the runtime's agents and return a per-request
 * clone of the matching agent.
 *
 * Dual return contract — both callers (`handle-run.ts`, `handle-connect.ts`)
 * depend on it:
 * - Returns a cloned `AbstractAgent` when the agent exists.
 * - Returns a 404 `Response` (`{ error: "Agent not found", ... }`) when the
 *   agent is unknown. Callers MUST `instanceof Response`-check the result and
 *   return it directly; this doubles as the connect/run path's agent-existence
 *   guard, so skipping the check would let unknown agent ids slip through.
 *
 * The clone is what subsequent per-request mutation (middleware attach,
 * `agent.headers` merge) operates on, leaving the shared agent registration
 * untouched.
 */
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
  /**
   * True when the React provider was given an A2UI catalog
   * (`<CopilotKit a2ui={{ catalog }}>`), forwarded per-run. A catalog alone is
   * enough to enable A2UI and inject the render tool — the developer no longer
   * has to also set `a2ui.injectA2UITool` on the runtime.
   */
  providerA2UIHasCatalog?: boolean;
}): void {
  const { runtime, request, agentId, providerA2UIHasCatalog } = params;
  const agent = params.agent as MiddlewareCapableAgent;

  // A2UI is on when the runtime explicitly enables it, OR when the provider
  // forwarded a catalog — but an explicit `enabled: false` always wins (we
  // provide a quick default, never override a deeper opt-out).
  const a2uiEnabledByCatalog =
    !!providerA2UIHasCatalog && runtime.a2ui?.enabled !== false;

  if (isA2UIEnabled(runtime.a2ui) || a2uiEnabledByCatalog) {
    // `enabled` is a CopilotKit-level switch, not an A2UIMiddleware option —
    // drop it (alongside the agent filter) before forwarding to the middleware.
    const {
      agents: targetAgents,
      enabled: _enabled,
      injectA2UITool,
      ...a2uiOptions
    } = runtime.a2ui ?? {};
    const shouldApply = !targetAgents || targetAgents.includes(agentId);
    if (shouldApply && typeof agent.use === "function") {
      agent.use(
        new A2UIMiddleware({
          ...a2uiOptions,
          // Default render-tool injection on when a catalog is present and the
          // developer hasn't set it explicitly. `??` means an explicit value
          // (including `false`) is always respected.
          injectA2UITool:
            injectA2UITool ?? (providerA2UIHasCatalog ? true : undefined),
        }),
      );
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

  // Forward eligible inbound headers onto the outgoing agent call under the
  // runtime's resolved forwarding policy (`authorization` / custom `x-*`, with
  // known infra/proxy/platform headers stripped by the default denylist —
  // #5712), but let headers the server explicitly configured on the agent WIN
  // on collision (case-insensitively): a server-set service-to-service token
  // (e.g. an IAM bearer) must never be silently overridden by a
  // browser/edge/platform-injected inbound header. See `mergeForwardableHeaders`
  // for the casing/duplicate-key rationale and `shouldForwardHeader` for breadth.
  agent.headers = mergeForwardableHeaders(
    agent.headers,
    request,
    // `forwardHeadersPolicy` is optional on the published `CopilotRuntimeLike`
    // interface (non-breaking minor release). Concrete runtimes always set it;
    // a policy-less external implementor falls back to the default resolved
    // policy (default-on denylist) so behavior stays identical and never derefs
    // undefined.
    runtime.forwardHeadersPolicy ?? resolveForwardHeadersPolicy(undefined),
  );
}

/**
 * Attach the Intelligence platform's MCP tools to the agent run when
 * `CopilotKitIntelligence` was constructed with
 * `enableEnterpriseLearning: true`. Uses `@ag-ui/mcp-middleware`, so the
 * tools are available uniformly across agent frameworks (not just
 * `BuiltInAgent`).
 *
 * The middleware sits on a per-request agent clone, so the per-request
 * auth (Bearer apiKey + resolved user-id) is baked into the transport
 * headers at attach time. If user resolution fails, attachment is
 * skipped silently — the intelligence run handler will reject the
 * request with the same error. Note this means `identifyUser` is
 * resolved twice per learning-enabled run (here and in the run handler);
 * the callback is expected to be idempotent and side-effect-free.
 *
 * Intentionally split out from `configureAgentForRequest`: this is only
 * relevant to actual agent runs, not auxiliary flows like thread-name
 * generation (which has no need for MCP tools and shouldn't pay the
 * `listTools` round-trip).
 */
export async function attachIntelligenceEnterpriseLearning(params: {
  runtime: CopilotRuntimeLike;
  request: Request;
  agent: AbstractAgent;
}): Promise<void> {
  const { runtime, request } = params;
  const agent = params.agent as MiddlewareCapableAgent;

  if (
    !isIntelligenceRuntime(runtime) ||
    !runtime.intelligence?.ɵisEnterpriseLearningEnabled?.()
  ) {
    return;
  }

  // Enterprise learning is enabled, but this agent's framework can't take
  // middleware — surface it rather than silently shipping a run with none
  // of the tools the operator opted into.
  if (typeof agent.use !== "function") {
    logger.warn(
      "CopilotKitIntelligence.enableEnterpriseLearning is enabled, but the agent " +
        "does not support middleware (no `.use()` method); Intelligence tools were " +
        "not attached for this run.",
    );
    return;
  }

  const userResult = await resolveIntelligenceUser({ runtime, request });
  if (userResult instanceof Response) return;

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
