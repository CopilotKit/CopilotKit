/**
 * Framework-agnostic CopilotKit runtime handler.
 *
 * Returns a pure `(Request) => Promise<Response>` function that can be used
 * directly with Bun, Deno, Cloudflare Workers, Next.js App Router, or any
 * Fetch-native runtime — no framework dependency required.
 *
 * @example
 * ```typescript
 * import { CopilotRuntime, createCopilotRuntimeHandler } from "@copilotkit/runtime/v2";
 *
 * const handler = createCopilotRuntimeHandler({
 *   runtime: new CopilotRuntime({ agents: { ... } }),
 *   basePath: "/api/copilotkit",
 *   cors: true,
 * });
 *
 * // Bun
 * Bun.serve({ fetch: handler });
 *
 * // Deno
 * Deno.serve(handler);
 *
 * // Cloudflare Workers
 * export default { fetch: handler };
 * ```
 */

import type {
  CopilotRuntimeLike,
  CopilotIntelligenceRuntimeLike,
} from "./runtime";
import { isIntelligenceRuntime } from "./runtime";
import { ChannelManager } from "./channel-manager";
import type { ChannelsControl, ActivateChannelEngine } from "./channel-manager";
import type { CopilotRuntimeHooks, RouteInfo, HookContext } from "./hooks";
import {
  runOnRequest,
  runOnBeforeHandler,
  runOnResponse,
  runOnError,
} from "./hooks";
import type { CopilotCorsConfig } from "./fetch-cors";
import { handleCors, addCorsHeaders } from "./fetch-cors";
import { matchRoute } from "./fetch-router";
import {
  callBeforeRequestMiddleware,
  callAfterRequestMiddleware,
} from "./middleware";
import { handleRunAgent } from "../handlers/handle-run";
import { handleSuggestAgent } from "../handlers/handle-suggest";
import { handleConnectAgent } from "../handlers/handle-connect";
import { handleStopAgent } from "../handlers/handle-stop";
import { handleGetRuntimeInfo } from "../handlers/get-runtime-info";
import { handleTranscribe } from "../handlers/handle-transcribe";
import { handleDebugEvents } from "../handlers/handle-debug-events";
import {
  handleClearThreads,
  handleListThreads,
  handleSubscribeToThreads,
  handleUpdateThread,
  handleArchiveThread,
  handleDeleteThread,
  handleGetThreadMessages,
  handleGetThreadEvents,
  handleGetThreadState,
} from "../handlers/handle-threads";
import {
  handleListMemories,
  handleSubscribeToMemories,
  handleCreateMemory,
  handleUpdateMemory,
  handleRemoveMemory,
} from "../handlers/handle-memories";
import { handleAnnotate } from "../handlers/handle-user-actions";
import {
  parseMethodCall,
  createJsonRequest,
  expectString,
} from "../endpoints/single-route-helpers";
import type { MethodCall } from "../endpoints/single-route-helpers";
import { logger } from "@copilotkit/shared";
import { fireInstanceCreatedTelemetry } from "../telemetry/instance-created";

/* ------------------------------------------------------------------------------------------------
 * Public types
 * --------------------------------------------------------------------------------------------- */

export interface CopilotRuntimeHandlerOptions {
  runtime: CopilotRuntimeLike;

  /**
   * Optional base path for routing.
   *
   * When provided: strict prefix stripping. The handler strips this prefix from the
   * URL pathname and matches the remainder against known routes.
   *
   * When omitted: suffix matching. The handler matches known route patterns as
   * suffixes of the URL pathname.
   */
  basePath?: string;

  /**
   * Endpoint mode:
   * - "multi-route" (default): Routes like POST /agent/:agentId/run, GET /info, etc.
   * - "single-route": Single POST endpoint with JSON envelope { method, params, body }
   */
  mode?: "multi-route" | "single-route";

  /**
   * Optional CORS configuration.
   * When not provided, no CORS headers are added (let the framework handle it).
   * Set to true for permissive defaults, or provide an object.
   */
  cors?: boolean | CopilotCorsConfig;

  /**
   * Lifecycle hooks for request processing.
   */
  hooks?: CopilotRuntimeHooks;

  /**
   * Whether the handler activates the runtime's declared managed Channels at
   * creation time. Defaults to `true`. Set `false` to skip activation entirely:
   * no {@link ChannelManager} is constructed and the returned handler has no
   * `.channels`. Non-intelligence or channel-less runtimes never activate
   * regardless of this flag.
   */
  activateChannels?: boolean;

  /**
   * @internal Test seam: inject a fake Channel activation engine so channel
   * activation runs without opening a real transport. Not part of the public
   * API and may change or be removed without notice.
   */
  __channelEngine?: ActivateChannelEngine;
}

/**
 * A framework-agnostic runtime handler: a `(Request) => Promise<Response>`
 * function that is also a callable object carrying an optional {@link channels}
 * control surface. A plain function is assignable to this type, so existing
 * call sites that treat it as `(Request) => Promise<Response>` keep working.
 */
export type CopilotRuntimeFetchHandler = ((
  request: Request,
) => Promise<Response>) & {
  /**
   * Present only when the handler activated managed Channels for an
   * Intelligence runtime; the lifecycle control surface for those Channels.
   */
  channels?: ChannelsControl;
};

/**
 * Managed Channel managers keyed by runtime instance. Guarantees a single
 * activation per runtime: creating the handler more than once for the same
 * runtime reuses the existing manager instead of activating a second time.
 */
const channelManagers = new WeakMap<object, ChannelManager>();

/**
 * Look up (or lazily create + activate) the {@link ChannelManager} for an
 * Intelligence runtime. First creation constructs the manager, calls
 * {@link ChannelManager.activate}, and only then caches it; subsequent lookups
 * reuse the cached manager so activation happens exactly once per runtime
 * instance. If `activate()` throws (an up-front misconfiguration), nothing is
 * cached and the error propagates on every attempt.
 *
 * @param runtime - The Intelligence runtime whose Channels to activate.
 * @param engine - Optional injected activation engine (test seam); when
 *   omitted the manager uses its default Realtime Gateway engine.
 * @returns The runtime's activated Channel manager.
 */
function getOrCreateChannelManager(
  runtime: CopilotIntelligenceRuntimeLike,
  engine: ActivateChannelEngine | undefined,
): ChannelManager {
  const existing = channelManagers.get(runtime);
  if (existing) {
    return existing;
  }
  const manager = new ChannelManager({
    intelligence: runtime.intelligence,
    channels: runtime.channels,
    // Bridge the manager's diagnostic sink to the shared logger. Without this
    // every `this.log?.(...)` breadcrumb in the manager (setup_required,
    // failed-to-activate, dropped-session, teardown-stop failures) is a no-op,
    // so a channel that fails to activate is permanently dead with zero output.
    // Mirror the `logger.<level>(context, message)` call shape used elsewhere in
    // this file; a failed activation is a degraded-but-recoverable condition, so
    // `warn` is the appropriate level.
    log: (msg, meta) => logger.warn({ meta }, msg),
    ...(engine ? { activateChannel: engine } : {}),
  });
  // Activate BEFORE caching. `activate()` throws synchronously on an up-front
  // misconfiguration (duplicate/missing channel names); caching first would
  // leave an inert, never-activated manager in the WeakMap, so a retried handler
  // creation would return it and skip re-activation — and its status() on empty
  // entries would falsely report `online`. Insert only after activate() succeeds
  // so a throw caches nothing and propagates cleanly on every attempt.
  manager.activate();
  channelManagers.set(runtime, manager);
  return manager;
}

/* ------------------------------------------------------------------------------------------------
 * Handler factory
 * --------------------------------------------------------------------------------------------- */

export function createCopilotRuntimeHandler(
  options: CopilotRuntimeHandlerOptions,
): CopilotRuntimeFetchHandler {
  const { runtime, basePath, mode = "multi-route", cors, hooks } = options;

  fireInstanceCreatedTelemetry({ runtime });

  const corsConfig = resolveCorsConfig(cors);

  const handler: CopilotRuntimeFetchHandler = async (
    request: Request,
  ): Promise<Response> => {
    const url = new URL(request.url, "http://localhost");
    const path = url.pathname;
    const requestOrigin = request.headers.get("origin");

    // Base hook context (route not yet known)
    const baseCtx: HookContext = { request, path, runtime };

    let route: RouteInfo | undefined;

    try {
      // 1. CORS preflight
      if (corsConfig) {
        const preflight = handleCors(request, corsConfig);
        if (preflight) return preflight;
      }

      // 2. onRequest hook
      request = await runOnRequest(hooks, { ...baseCtx, request });

      // 3. Legacy beforeRequestMiddleware
      try {
        const maybeModified = await callBeforeRequestMiddleware({
          runtime,
          request,
          path,
        });
        if (maybeModified) {
          request = maybeModified;
        }
      } catch (mwError: unknown) {
        logger.error(
          { err: mwError, url: request.url, path },
          "Error running before request middleware",
        );
        if (mwError instanceof Response) {
          return maybeAddCors(mwError, corsConfig, requestOrigin);
        }
        throw mwError;
      }

      // 4. Route matching
      let response: Response;

      if (mode === "single-route") {
        const resolved = await resolveSingleRoute(request, basePath, path);
        route = resolved.route;
        const { methodCall } = resolved;
        // 5. onBeforeHandler hook
        request = await runOnBeforeHandler(hooks, {
          request,
          path,
          runtime,
          route,
        });
        // 6. Wrap body for methods that need it, then dispatch
        if (
          route.method === "agent/run" ||
          route.method === "agent/suggest" ||
          route.method === "agent/connect" ||
          route.method === "transcribe"
        ) {
          request = createJsonRequest(request, methodCall.body);
        }
        response = await dispatchRoute(runtime, request, route, {
          threadEndpointsEnabled: false,
        });
      } else {
        // Multi-route: match URL pattern
        const matched = matchRoute(path, basePath);
        if (!matched) {
          throw jsonResponse({ error: "Not found" }, 404);
        }

        // Validate HTTP method
        const methodError = validateHttpMethod(request.method, matched);
        if (methodError) {
          route = matched;
          throw methodError;
        }

        route = matched;

        // 5. onBeforeHandler hook
        request = await runOnBeforeHandler(hooks, {
          request,
          path,
          runtime,
          route,
        });

        // 6. Handler dispatch
        response = await dispatchRoute(runtime, request, route, {
          threadEndpointsEnabled: true,
        });
      }

      // 7. onResponse hook
      response = await runOnResponse(hooks, {
        request,
        response,
        path,
        runtime,
        route,
      });

      // 8. CORS headers on response
      response = maybeAddCors(response, corsConfig, requestOrigin);

      // 9. Legacy afterRequestMiddleware (non-blocking)
      // Clone the response so middleware can read the body without consuming
      // the original stream that will be sent to the client.
      callAfterRequestMiddleware({
        runtime,
        response: response.clone(),
        path,
      }).catch((error: unknown) => {
        logger.error(
          { err: error, url: request.url, path },
          "Error running after request middleware",
        );
      });

      return response;
    } catch (error) {
      // Short-circuit with thrown Response
      if (error instanceof Response) {
        const finalResponse = await runOnResponse(hooks, {
          request,
          response: error,
          path,
          runtime,
          route: route ?? { method: "info" },
        });
        return maybeAddCors(finalResponse, corsConfig, requestOrigin);
      }

      // Run onError hook — wrapped so a throwing hook doesn't escape
      try {
        const errorResponse = await runOnError(hooks, {
          request,
          error,
          path,
          runtime,
          route,
        });

        if (errorResponse) {
          return maybeAddCors(errorResponse, corsConfig, requestOrigin);
        }
      } catch (hookError: unknown) {
        logger.error(
          { err: hookError, originalErr: error, url: request.url, path },
          "onError hook threw",
        );
      }

      logger.error(
        { err: error, url: request.url, path },
        "Unhandled error in CopilotKit runtime handler",
      );

      return maybeAddCors(
        jsonResponse({ error: "internal_error" }, 500),
        corsConfig,
        requestOrigin,
      );
    }
  };

  // Managed Channel activation happens here — at handler-creation time, not in
  // the Runtime constructor and not inside the per-request closure above (the
  // first HTTP request must not trigger activation). Only for an Intelligence
  // runtime that declares Channels and hasn't opted out via activateChannels.
  if (
    isIntelligenceRuntime(runtime) &&
    runtime.channels &&
    runtime.channels.length > 0 &&
    options.activateChannels !== false
  ) {
    handler.channels = getOrCreateChannelManager(
      runtime,
      options.__channelEngine,
    );
  }

  return handler;
}

/* ------------------------------------------------------------------------------------------------
 * Route dispatch
 * --------------------------------------------------------------------------------------------- */

function dispatchRoute(
  runtime: CopilotRuntimeLike,
  request: Request,
  route: RouteInfo,
  options: { threadEndpointsEnabled: boolean },
): Promise<Response> {
  switch (route.method) {
    case "agent/run":
      return handleRunAgent({
        runtime,
        request,
        agentId: route.agentId,
      });
    case "agent/suggest":
      return handleSuggestAgent({
        runtime,
        request,
        agentId: route.agentId,
      });
    case "agent/connect":
      return handleConnectAgent({
        runtime,
        request,
        agentId: route.agentId,
      });
    case "agent/stop":
      return handleStopAgent({
        runtime,
        request,
        agentId: route.agentId,
        threadId: route.threadId,
      });
    case "info":
      return handleGetRuntimeInfo({
        runtime,
        request,
        threadEndpointsEnabled: options.threadEndpointsEnabled,
      });
    case "transcribe":
      return handleTranscribe({ runtime, request });
    case "threads/clear":
      return Promise.resolve(handleClearThreads({ runtime, request }));
    case "threads/list":
      return handleListThreads({ runtime, request });
    case "memories/list":
      return request.method.toUpperCase() === "POST"
        ? handleCreateMemory({ runtime, request })
        : handleListMemories({ runtime, request });
    case "memories/subscribe":
      return handleSubscribeToMemories({ runtime, request });
    case "memories/mutate":
      return request.method.toUpperCase() === "DELETE"
        ? handleRemoveMemory({ runtime, request, memoryId: route.memoryId })
        : handleUpdateMemory({ runtime, request, memoryId: route.memoryId });
    case "threads/subscribe":
      return handleSubscribeToThreads({ runtime, request });
    case "threads/update":
      if (request.method.toUpperCase() === "DELETE") {
        return handleDeleteThread({
          runtime,
          request,
          threadId: route.threadId,
        });
      }
      return handleUpdateThread({ runtime, request, threadId: route.threadId });
    case "threads/archive":
      return handleArchiveThread({
        runtime,
        request,
        threadId: route.threadId,
      });
    case "threads/messages":
      return handleGetThreadMessages({
        runtime,
        request,
        threadId: route.threadId,
      });
    case "threads/events":
      return handleGetThreadEvents({
        runtime,
        request,
        threadId: route.threadId,
      });
    case "threads/state":
      return handleGetThreadState({
        runtime,
        request,
        threadId: route.threadId,
      });
    case "annotate":
      return handleAnnotate({ runtime, request });
    case "cpk-debug-events":
      return Promise.resolve(handleDebugEvents({ runtime, request }));
    default: {
      // Exhaustiveness guard: a new `RouteInfo` variant added without a case
      // above becomes a compile error here instead of silently returning
      // `undefined` at runtime.
      const _exhaustive: never = route;
      throw jsonResponse(
        { error: "Not found", method: (_exhaustive as RouteInfo).method },
        404,
      );
    }
  }
}

interface SingleRouteResolution {
  route: RouteInfo;
  methodCall: MethodCall;
}

async function resolveSingleRoute(
  request: Request,
  basePath: string | undefined,
  pathname: string,
): Promise<SingleRouteResolution> {
  if (basePath) {
    const normalizedBase =
      basePath.length > 1 && basePath.endsWith("/")
        ? basePath.slice(0, -1)
        : basePath;
    if (!pathname.startsWith(normalizedBase)) {
      throw jsonResponse({ error: "Not found" }, 404);
    }
  }

  if (request.method !== "POST") {
    throw jsonResponse({ error: "Method not allowed" }, 405, { Allow: "POST" });
  }

  const methodCall = await parseMethodCall(request);

  let route: RouteInfo;
  switch (methodCall.method) {
    case "agent/run":
      route = {
        method: "agent/run",
        agentId: expectString(methodCall.params, "agentId"),
      };
      break;
    case "agent/suggest":
      route = {
        method: "agent/suggest",
        agentId: expectString(methodCall.params, "agentId"),
      };
      break;
    case "agent/connect":
      route = {
        method: "agent/connect",
        agentId: expectString(methodCall.params, "agentId"),
      };
      break;
    case "agent/stop":
      route = {
        method: "agent/stop",
        agentId: expectString(methodCall.params, "agentId"),
        threadId: expectString(methodCall.params, "threadId"),
      };
      break;
    case "info":
      route = { method: "info" };
      break;
    case "transcribe":
      route = { method: "transcribe" };
      break;
    default: {
      // Exhaustiveness guard: a new `METHOD_NAMES`/`EndpointMethod` variant
      // added without a case above becomes a compile error here instead of
      // leaving `route` unassigned at runtime.
      const _exhaustive: never = methodCall.method;
      throw jsonResponse({ error: "Not found", method: _exhaustive }, 404);
    }
  }

  return { route, methodCall };
}

/* ------------------------------------------------------------------------------------------------
 * HTTP method validation
 * --------------------------------------------------------------------------------------------- */

function validateHttpMethod(
  httpMethod: string,
  route: RouteInfo,
): Response | null {
  const method = httpMethod.toUpperCase();

  switch (route.method) {
    case "info":
    case "threads/list":
    case "threads/messages":
    case "threads/events":
    case "threads/state":
    case "cpk-debug-events":
      if (method === "GET") return null;
      return jsonResponse({ error: "Method not allowed" }, 405, {
        Allow: "GET",
      });

    case "memories/list":
      // GET lists the user's memories; POST creates one.
      if (method === "GET" || method === "POST") return null;
      return jsonResponse({ error: "Method not allowed" }, 405, {
        Allow: "GET, POST",
      });

    case "memories/mutate":
      // PATCH supersedes; DELETE retires.
      if (method === "PATCH" || method === "DELETE") return null;
      return jsonResponse({ error: "Method not allowed" }, 405, {
        Allow: "PATCH, DELETE",
      });

    case "threads/update":
      if (method === "PATCH" || method === "DELETE") return null;
      return jsonResponse({ error: "Method not allowed" }, 405, {
        Allow: "PATCH, DELETE",
      });

    default:
      if (method === "POST") return null;
      return jsonResponse({ error: "Method not allowed" }, 405, {
        Allow: "POST",
      });
  }
}

/* ------------------------------------------------------------------------------------------------
 * Helpers
 * --------------------------------------------------------------------------------------------- */

function resolveCorsConfig(
  cors: boolean | CopilotCorsConfig | undefined,
): CopilotCorsConfig | null {
  if (!cors) return null;
  if (cors === true) return {};
  return cors;
}

function maybeAddCors(
  response: Response,
  config: CopilotCorsConfig | null,
  requestOrigin: string | null,
): Response {
  if (!config) return response;
  return addCorsHeaders(response, config, requestOrigin);
}

function jsonResponse(
  body: unknown,
  status: number,
  extraHeaders?: Record<string, string>,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...extraHeaders },
  });
}
