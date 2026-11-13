import type { AbstractAgent, RunAgentInput } from "@ag-ui/client";
import { RunAgentInputSchema } from "@ag-ui/core/schemas";
import type { CopilotKitUIEnvelope } from "@copilotkit/shared";
import { A2UIMiddleware } from "@ag-ui/a2ui-middleware";
import { OpenGenerativeUIMiddleware } from "../../event-transforms";
import { MCPAppsMiddleware } from "@ag-ui/mcp-apps-middleware";
import { MCPMiddleware } from "@ag-ui/mcp-middleware";
import {
  A2UIV09BridgeMiddleware,
  GenerativeUIMiddleware,
  resolveA2UIVersion,
} from "../../generative-ui";
import type { CopilotKitRuntimeLike } from "../../core/runtime";
import { isIntelligenceRuntime, resolveAgents } from "../../core/runtime";
import {
  INTELLIGENCE_MEMORY_GRANT_HEADER,
  INTELLIGENCE_USER_ID_HEADER,
} from "../../intelligence-platform/client";
import {
  mergeForwardableHeaders,
  resolveForwardHeadersPolicy,
} from "../header-utils";
import { resolveMcpAppsServers } from "./mcp-apps-servers";
import { resolveIntelligenceUser } from "./resolve-intelligence-user";
import { grantAllowsMemory, resolveWebMemory } from "./memory-policy";
import { errorResponse } from "./json-response";
import { processEnv } from "@copilotkit/shared";
import { getRuntimeLogger } from "../../core/logger";
import type { CopilotKitRuntimeLogger } from "../../core/logger";

type MiddlewareCapableAgent = AbstractAgent & {
  use?: (middleware: unknown) => void;
  headers?: Record<string, string>;
};

export interface RunAgentParameters {
  request: Request;
  runtime: CopilotKitRuntimeLike;
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
  runtime: CopilotKitRuntimeLike,
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
  runtime: CopilotKitRuntimeLike;
  request: Request;
  agentId: string;
  agent: AbstractAgent;
  /**
   * The transport of the generative UI envelope that the client sent on this
   * run (`forwardedProps.copilotkit.ui`). Not set when the run has no envelope.
   */
  providerGenerativeUITransport?: CopilotKitUIEnvelope["metadata"]["extensions"]["copilotkit_transport"];
  /** Retain proxy rejection even when no server is available to this agent. */
  isMcpProxyRequest?: boolean;
}): void {
  const { runtime, request, agentId, isMcpProxyRequest } = params;
  const agent = params.agent as MiddlewareCapableAgent;

  // Generative UI is on for a run with a "tool" envelope, and for every run
  // when the runtime turns it on. A "markdown" envelope means the model writes
  // ```a2ui fences, so the run gets no render tool, even when the runtime
  // turns generative UI on. `false` and the `agents` filter always win.
  const generativeUI = runtime.generativeUI;
  const generativeUIOptions =
    typeof generativeUI === "object" ? generativeUI : undefined;
  const transport = params.providerGenerativeUITransport;
  const isGenerativeUIRun =
    generativeUI !== false &&
    (transport === "tool" || (transport !== "markdown" && !!generativeUI)) &&
    (!generativeUIOptions?.agents ||
      generativeUIOptions.agents.includes(agentId)) &&
    typeof agent.use === "function";
  const a2uiVersion = resolveA2UIVersion(generativeUI, agentId);

  if (isGenerativeUIRun) {
    // The bridge comes first, so it is the outermost middleware: it changes
    // the input before `A2UIMiddleware` reads it, and converts the v0.9
    // surfaces that `A2UIMiddleware` emits.
    agent.use(new A2UIV09BridgeMiddleware({ agentVersion: a2uiVersion }));
    if (a2uiVersion === "0.9") {
      const {
        agents: _agents,
        a2uiVersion: _a2uiVersion,
        injectA2UITool,
        ...a2uiOptions
      } = generativeUIOptions ?? {};
      agent.use(
        new A2UIMiddleware({
          ...a2uiOptions,
          // The envelope of a "tool" run carries the client's catalog, so the
          // agent gets the render tool. An explicit value (also `false`) wins.
          injectA2UITool: injectA2UITool ?? transport === "tool",
        }),
      );
    } else {
      // No tool and no schema, so the agent gets no v0.9 prompt. It still
      // turns v0.9 operations in tool results (`{ "a2ui_operations": [...] }`)
      // into surfaces, which the bridge converts to 1.0.
      agent.use(new A2UIMiddleware());
    }
  }

  if (isIntelligenceRuntime(runtime) && typeof agent.use === "function") {
    // Ordinary runs need no middleware without selected servers. Proxy requests
    // still need the upstream guard so they cannot fall through to the model.
    const mcpServers = resolveMcpAppsServers(
      runtime.mcpApps?.servers ?? [],
      agentId,
    );
    if (mcpServers.length > 0 || isMcpProxyRequest) {
      agent.use(
        new MCPAppsMiddleware({ mcpServers, discoveryFailureMode: "throw" }),
      );
    }
  } else if (runtime.mcpApps?.servers?.length) {
    const mcpServers = resolveMcpAppsServers(runtime.mcpApps.servers, agentId);

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

  // A v0.9 agent gets `render_a2ui` (above) instead of `render_ui`.
  if (isGenerativeUIRun && a2uiVersion === "1.0") {
    agent.use(new GenerativeUIMiddleware());
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
    // `forwardHeadersPolicy` is optional on the published `CopilotKitRuntimeLike`
    // interface (non-breaking minor release). Concrete runtimes always set it;
    // a policy-less external implementor falls back to the default resolved
    // policy (default-on denylist) so behavior stays identical and never derefs
    // undefined.
    runtime.forwardHeadersPolicy ?? resolveForwardHeadersPolicy(undefined),
  );
}

/**
 * Shared by the two places a run meets a middleware-less agent: before Memory
 * is resolved (nothing left to resolve) and after (Memory resolved to nothing).
 */
const NO_MIDDLEWARE_WARNING =
  "CopilotKitIntelligence.enableEnterpriseLearning is enabled, but the agent " +
  "does not support middleware (no `.use()` method); Intelligence tools were " +
  "not attached for this run.";

/**
 * Attach CopilotKit Intelligence's MCP tools to the agent run when
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
  runtime: CopilotKitRuntimeLike;
  request: Request;
  agent: AbstractAgent;
}): Promise<void | Response> {
  const { runtime, request } = params;
  const agent = params.agent as MiddlewareCapableAgent;

  if (!isIntelligenceRuntime(runtime)) return;

  const learningEnabled =
    runtime.intelligence?.ɵisEnterpriseLearningEnabled?.() === true;
  if (runtime.memory === undefined && !learningEnabled) return;

  // Nothing here is resolvable for an agent whose framework can't take
  // middleware and whose runtime configures no Memory — bail before paying for
  // `identifyUser`, so an enterprise-learning-only run keeps warning rather
  // than acquiring a new way to fail.
  if (runtime.memory === undefined && typeof agent.use !== "function") {
    getRuntimeLogger(runtime).warn(NO_MIDDLEWARE_WARNING);
    return;
  }

  const userResult = await resolveIntelligenceUser({ runtime, request });
  if (userResult instanceof Response) return userResult;
  const access = await resolveWebMemory(runtime, request, userResult, "agent");
  if (access instanceof Response) return access;

  const memoryGranted =
    runtime.memory !== undefined && grantAllowsMemory(access.grant);

  // A policy that grants no scope means this run gets no Memory — it does NOT
  // mean the run is refused. Attach nothing and let the conversation proceed,
  // exactly as a Channel does when its grant asks for nothing
  // (`hasMemoryAccess` in @copilotkit/channels-core). Returning a 403 here
  // instead fails the whole run, so switching Memory off for one tenant would
  // leave that tenant with no assistant, and the only signal is a run error the
  // chat surface has no reason to render.
  //
  // Enterprise learning rides the SAME MCP server, so "no Memory" must not cost
  // an operator the learning tools too. When it is on, attach anyway and let
  // Intelligence filter: it registers one Memory tool per granted scope and
  // none at all for an all-none grant, leaving the learning tools untouched.
  if (!memoryGranted && !learningEnabled) return;

  // Whatever is left to attach needs middleware. Failing the run is right only
  // when Memory was actually granted and cannot be delivered; a run that merely
  // wanted learning tools warns and proceeds, as it always has.
  if (typeof agent.use !== "function") {
    if (memoryGranted) {
      return errorResponse(
        "Memory is configured, but this agent does not support middleware",
        500,
      );
    }
    getRuntimeLogger(runtime).warn(NO_MIDDLEWARE_WARNING);
    return;
  }

  agent.use(
    new MCPMiddleware([
      {
        type: "http",
        url: `${runtime.intelligence.ɵgetApiUrl()}/mcp`,
        serverId: "intelligence",
        headers: {
          Authorization: `Bearer ${runtime.intelligence.ɵgetApiKey()}`,
          [INTELLIGENCE_USER_ID_HEADER]: userResult.id,
          ...(runtime.memory
            ? {
                [INTELLIGENCE_MEMORY_GRANT_HEADER]: JSON.stringify(
                  access.grant,
                ),
              }
            : {}),
        },
      },
    ]),
  );
}

// Intentional local exception: HTTP request parsing runs before AG-UI's event
// compatibility boundary. Mirror its historically accepted optional-null rules
// and its legacy binary-part upgrade here, without depending on a new public
// AG-UI helper (AG-UI does not export one). Keep these aligned
// with client/src/middleware/compatibility-boundary.ts and AG-UI's migration guide.
// Required nulls and nulls within application data must remain untouched.
function warnCompatibility(
  what: string,
  replacement: string,
  logger: CopilotKitRuntimeLogger,
) {
  if (
    typeof process !== "undefined" &&
    typeof processEnv() !== "undefined" &&
    processEnv().SUPPRESS_TRANSFORMATION_WARNINGS
  )
    return;
  logger.warn(
    `[ag-ui][compat] Converting deprecated ${what} to ${replacement}. The old shape leaves the protocol after its shim window — see the repo-root DEPRECATIONS.md. Set SUPPRESS_TRANSFORMATION_WARNINGS=true to silence.`,
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function omitLegacyNull(
  value: unknown,
  field: string,
  context: string,
  logger: CopilotKitRuntimeLogger,
): unknown {
  if (!isRecord(value) || value[field] !== null) return value;
  warnCompatibility(`${context}.${field}: null`, "an absent field", logger);
  const { [field]: _null, ...rest } = value;
  return rest;
}

function mapProtocolArray(
  value: unknown,
  field: string,
  normalize: (entry: unknown) => unknown,
): unknown {
  if (!isRecord(value) || !Array.isArray(value[field])) return value;
  const original = value[field];
  const entries = original.map(normalize);
  return entries.some((entry, index) => entry !== original[index])
    ? { ...value, [field]: entries }
    : value;
}

function mediaTypeFor(
  mimeType: string,
): "image" | "audio" | "video" | "document" {
  if (mimeType.startsWith("image/")) return "image";
  if (mimeType.startsWith("audio/")) return "audio";
  if (mimeType.startsWith("video/")) return "video";
  return "document";
}

function sameSource(part: unknown, converted: Record<string, unknown>) {
  if (!isRecord(part) || part.type !== converted.type) return false;
  const a = part.source;
  const b = converted.source as Record<string, unknown>;
  return (
    isRecord(a) &&
    a.type === b.type &&
    a.value === b.value &&
    a.mimeType === b.mimeType
  );
}

/**
 * The 0.x `{ type: "binary" }` part, which 1.0 retired and main accepted.
 * Mirrors AG-UI's outgoing upgrade (client/src/middleware/legacy-content.ts):
 * data or url becomes the media part its mime type names, and a binary part
 * that only mirrors a modern part already in the message is dropped. A part
 * with only an `id` has no 1.0 form; it is dropped with a warning instead of
 * failing the whole request, which is what BuiltInAgent already did with it.
 */
function upgradeLegacyBinaryParts(
  content: unknown[],
  logger: CopilotKitRuntimeLogger,
): unknown[] {
  return content.flatMap((part) => {
    if (
      !isRecord(part) ||
      part.type !== "binary" ||
      typeof part.mimeType !== "string"
    )
      return [part];
    const kind =
      typeof part.data === "string"
        ? "data"
        : typeof part.url === "string"
          ? "url"
          : null;
    if (kind === null) {
      logger.warn(
        "[CopilotKit] Dropping a legacy binary content part that has no data or url; AG-UI 1.0 has no equivalent for it.",
      );
      return [];
    }
    warnCompatibility(
      "binary input content",
      "the modern media content part",
      logger,
    );
    const converted: Record<string, unknown> = {
      type: mediaTypeFor(part.mimeType),
      source: {
        type: kind,
        value: kind === "data" ? part.data : part.url,
        mimeType: part.mimeType,
      },
      ...(typeof part.filename === "string"
        ? { metadata: { filename: part.filename } }
        : {}),
    };
    return content.some((other) => sameSource(other, converted))
      ? []
      : [converted];
  });
}

function normalizeLegacyMessageContent(
  message: unknown,
  logger: CopilotKitRuntimeLogger,
): unknown {
  const upgraded =
    isRecord(message) &&
    Array.isArray(message.content) &&
    message.content.some((part) => isRecord(part) && part.type === "binary")
      ? {
          ...message,
          content: upgradeLegacyBinaryParts(message.content, logger),
        }
      : message;
  return mapProtocolArray(upgraded, "content", (part) => {
    if (!isRecord(part)) return part;
    switch (part.type) {
      case "image":
      case "audio":
      case "video":
      case "document":
        return omitLegacyNull(
          part,
          "metadata",
          `${part.type} input content`,
          logger,
        );
      default:
        return part;
    }
  });
}

function normalizeLegacyRunAgentInput(
  input: unknown,
  logger: CopilotKitRuntimeLogger,
): unknown {
  let normalized = omitLegacyNull(
    input,
    "forwardedProps",
    "RunAgentInput",
    logger,
  );
  normalized = mapProtocolArray(normalized, "tools", (tool) =>
    omitLegacyNull(tool, "parameters", "Tool", logger),
  );
  normalized = mapProtocolArray(normalized, "resume", (entry) =>
    omitLegacyNull(entry, "payload", "ResumeEntry", logger),
  );
  return mapProtocolArray(normalized, "messages", (message) =>
    normalizeLegacyMessageContent(message, logger),
  );
}

function parseRunAgentInput(
  value: unknown,
  logger: CopilotKitRuntimeLogger,
): RunAgentInput {
  // With strictNullChecks disabled, Zod infers some required nested fields
  // (such as image.source) as optional. The schema still validates them.
  return RunAgentInputSchema.parse(
    normalizeLegacyRunAgentInput(value, logger),
  ) as RunAgentInput;
}

export async function parseRunRequest(
  request: Request,
  logger: CopilotKitRuntimeLogger = getRuntimeLogger(),
): Promise<RunAgentInput | Response> {
  try {
    const requestBody = await request.json();
    return parseRunAgentInput(requestBody, logger);
  } catch (error) {
    logger.error({ err: error }, "Invalid run request body");
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

export async function parseConnectRequest(
  request: Request,
  logger: CopilotKitRuntimeLogger = getRuntimeLogger(),
): Promise<
  | Response
  | {
      input: RunAgentInput;
      lastSeenEventId: string | null;
    }
> {
  try {
    const requestBody = await request.json();
    const input = parseRunAgentInput(requestBody, logger);
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
    logger.error({ err: error }, "Invalid connect request body");
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
