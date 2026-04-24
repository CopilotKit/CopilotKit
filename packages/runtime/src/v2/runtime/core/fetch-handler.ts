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

import type { CopilotRuntimeLike } from "./runtime";
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
import { handleConnectAgent } from "../handlers/handle-connect";
import { handleStopAgent } from "../handlers/handle-stop";
import { handleGetRuntimeInfo } from "../handlers/get-runtime-info";
import { handleTranscribe } from "../handlers/handle-transcribe";
import { handleDebugEvents } from "../handlers/handle-debug-events";
import {
  handleListThreads,
  handleSubscribeToThreads,
  handleUpdateThread,
  handleArchiveThread,
  handleDeleteThread,
  handleGetThreadMessages,
} from "../handlers/handle-threads";
import {
  parseMethodCall,
  createJsonRequest,
  expectString,
  type MethodCall,
} from "../endpoints/single-route-helpers";
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
}

export type CopilotRuntimeFetchHandler = (
  request: Request,
) => Promise<Response>;

/* ------------------------------------------------------------------------------------------------
 * Handler factory
 * --------------------------------------------------------------------------------------------- */

export function createCopilotRuntimeHandler(
  options: CopilotRuntimeHandlerOptions,
): CopilotRuntimeFetchHandler {
  const { runtime, basePath, mode = "multi-route", cors, hooks } = options;

  fireInstanceCreatedTelemetry({ runtime });

  const corsConfig = resolveCorsConfig(cors);

  return async (request: Request): Promise<Response> => {
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
          route.method === "agent/connect" ||
          route.method === "transcribe"
        ) {
          request = createJsonRequest(request, methodCall.body);
        }
        response = await dispatchRoute(runtime, request, route);
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
        response = await dispatchRoute(runtime, request, route);
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
}

/* ------------------------------------------------------------------------------------------------
 * Route dispatch
 * --------------------------------------------------------------------------------------------- */

function dispatchRoute(
  runtime: CopilotRuntimeLike,
  request: Request,
  route: RouteInfo,
): Promise<Response> {
  switch (route.method) {
    case "agent/run":
      return handleRunAgent({
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
      return handleGetRuntimeInfo({ runtime, request });
    case "transcribe":
      return handleTranscribe({ runtime, request });
    case "threads/list":
      return handleListThreads({ runtime, request });
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
    case "cpk-debug-events":
      return Promise.resolve(handleDebugEvents({ runtime, request }));
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
    case "cpk-debug-events":
      if (method === "GET") return null;
      return jsonResponse({ error: "Method not allowed" }, 405, {
        Allow: "GET",
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
