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
 *
 * ## Managed Channels lifecycle (serverless-safe)
 *
 * When the runtime declares managed Channels, the returned handler carries a
 * `handler.channels` control surface — but creating the handler opens NO
 * network connection. Activation (which opens a persistent gateway WebSocket)
 * is LAZY: it is triggered by the first `await handler.channels.ready()` and
 * never before — not at handler creation, not on the first HTTP request.
 *
 * - On a LONG-RUNNING host (a Node server / container / the node/express/hono
 *   endpoint wrappers), call `await handler.channels.ready()` ONCE at startup to
 *   open the listener; the process owns it for its lifetime.
 * - On a SERVERLESS / EDGE host (Cloudflare Workers, Next.js App Router), do NOT
 *   call `ready()` — those hosts freeze/recycle per-request isolates and cannot
 *   own a persistent listener, and separate cold starts would mint conflicting
 *   listeners. The generic Fetch handler stays a pure request/response function
 *   there, exactly as documented above.
 *
 * @example
 * ```typescript
 * // Long-running host: open the managed-Channel listener once at startup.
 * const handler = createCopilotRuntimeHandler({ runtime });
 * await handler.channels.ready();
 * ```
 */

import type {
  CopilotRuntimeLike,
  CopilotIntelligenceRuntimeLike,
  RuntimeWithDeclaredChannels,
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
  handleRecallMemories,
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
   * Whether the handler builds the runtime's declared managed-Channel control
   * surface. Defaults to `true`, which constructs the {@link ChannelManager} and
   * exposes `handler.channels` — but does NOT open any connection: activation is
   * lazy and triggered by the first `handler.channels.ready()` (see the factory
   * TSDoc). Set `false` to opt out entirely: no {@link ChannelManager} is
   * constructed and the returned handler has no `.channels`. Non-intelligence or
   * channel-less runtimes never build a control surface regardless of this flag.
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
 * A {@link CopilotRuntimeFetchHandler} whose {@link ChannelsControl} surface is
 * guaranteed present. Returned when the runtime was constructed with at least
 * one declared Intelligence Channel and activation was not opted out of, so the
 * documented `handler.channels.ready(...)` call type-checks without a `!` or
 * `?.` under strict TypeScript.
 */
export type CopilotRuntimeFetchHandlerWithChannels = ((
  request: Request,
) => Promise<Response>) & {
  /** Lifecycle control surface for the runtime's activated managed Channels. */
  channels: ChannelsControl;
};

/**
 * Managed Channel managers keyed by runtime instance. Guarantees a single
 * manager (and thus a single activation) per runtime: creating the handler more
 * than once for the same runtime reuses the existing manager instead of
 * constructing a second one.
 */
const channelManagers = new WeakMap<object, ChannelManager>();

/**
 * Look up (or lazily CREATE) the {@link ChannelManager} for an Intelligence
 * runtime. First creation constructs the manager and caches it; subsequent
 * lookups reuse the cached instance so there is exactly one manager per runtime.
 *
 * Activation is NOT triggered here. Constructing the manager opens no
 * transport — the persistent gateway socket is opened lazily on the first
 * {@link ChannelManager.ready} call (see the factory TSDoc). This keeps the
 * generic Fetch handler serverless/edge-safe: creating it (e.g. at
 * Cloudflare-Worker module scope or per Next.js App Router isolate) never
 * performs network I/O and never mints a listener the host cannot own.
 *
 * Caching the un-activated manager is correct: a later `ready()` activates it
 * once (idempotently), and an up-front misconfiguration (duplicate/missing
 * channel names) surfaces as a rejected `ready()` rather than a throw at
 * creation. A manager that has been {@link ChannelManager.stop}ped stays
 * stopped on reuse — its latches short-circuit any later `activate()`/`ready()`.
 *
 * @param runtime - The Intelligence runtime whose Channels the manager drives.
 * @param engine - Optional injected activation engine (test seam); when
 *   omitted the manager uses its default Realtime Gateway engine.
 * @returns The runtime's (un-activated) Channel manager.
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
    // `warn` is the appropriate level. The manager passes an `Error` as `meta`
    // for failure breadcrumbs, but pino only serializes an Error (its
    // non-enumerable message/stack) under the `err` key — under any other key it
    // renders as `{}` and the cause is lost. Route an Error to `err` and keep the
    // `meta` key for everything else (`meta` is typed `unknown`).
    log: (msg, meta) =>
      logger.warn(meta instanceof Error ? { err: meta } : { meta }, msg),
    ...(engine ? { activateChannel: engine } : {}),
  });
  channelManagers.set(runtime, manager);
  return manager;
}

/* ------------------------------------------------------------------------------------------------
 * Handler factory
 * --------------------------------------------------------------------------------------------- */

/**
 * Overload: a runtime constructed with at least one declared Intelligence
 * Channel (a {@link RuntimeWithDeclaredChannels}-branded runtime), when
 * activation is not disabled, yields a handler with a **non-optional**
 * {@link ChannelsControl}. `activateChannels` is constrained to `true | undefined`
 * here so passing `activateChannels: false` (which skips activation and leaves no
 * `.channels`) falls through to the optional-shape overload below rather than
 * dishonestly promising a control surface that will not exist.
 */
export function createCopilotRuntimeHandler(
  options: CopilotRuntimeHandlerOptions & {
    runtime: RuntimeWithDeclaredChannels;
    activateChannels?: true | undefined;
  },
): CopilotRuntimeFetchHandlerWithChannels;
/**
 * Overload: every other runtime (SSE, Intelligence without channels, or with
 * activation disabled) yields a handler whose `.channels` is optional.
 */
export function createCopilotRuntimeHandler(
  options: CopilotRuntimeHandlerOptions,
): CopilotRuntimeFetchHandler;
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

        // Opt-in gate for the client-facing memory proxy routes (secure
        // default: off). Runs BEFORE method validation so a hidden route 404s
        // uniformly regardless of HTTP method — a 405 here would otherwise leak
        // that the route exists. `dispatchRoute` re-applies the same gate as
        // defense-in-depth (and to cover the single-route path).
        if (
          matched.method.startsWith("memories/") &&
          runtime.exposeMemoryRoutes !== true
        ) {
          route = matched;
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

  // Build (but do NOT activate) the managed-Channel control surface for an
  // Intelligence runtime that declares Channels and hasn't opted out via
  // activateChannels. `handler.channels` exists immediately, but the persistent
  // gateway socket is opened lazily on the first `handler.channels.ready()` —
  // never at handler-creation time and never inside the per-request closure
  // above. This keeps the generic Fetch handler serverless/edge-safe: no
  // module-scope network I/O, and no listener a request-driven isolate cannot
  // own. See the factory TSDoc for the full lifecycle contract.
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
  // Opt-in gate for the client-facing memory proxy routes (secure default:
  // off). When not explicitly enabled, every `/memories/*` route 404s as if it
  // did not exist — this MUST run before the per-handler `isIntelligenceRuntime`
  // check so an un-opted-in deployment reveals nothing about memory (not even
  // whether Intelligence is configured). Coalesce a missing flag (external
  // `CopilotRuntimeLike` implementor) to `false`.
  if (
    route.method.startsWith("memories/") &&
    runtime.exposeMemoryRoutes !== true
  ) {
    throw jsonResponse({ error: "Not found" }, 404);
  }

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
    case "memories/recall":
      return handleRecallMemories({ runtime, request });
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

    case "memories/recall":
      // POST-only: semantic recall carries its query in the body.
      if (method === "POST") return null;
      return jsonResponse({ error: "Method not allowed" }, 405, {
        Allow: "POST",
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
