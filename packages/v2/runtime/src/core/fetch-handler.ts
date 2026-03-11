/**
 * Framework-agnostic CopilotKit runtime handler.
 *
 * Returns a pure `(Request) => Promise<Response>` function that can be used
 * directly with Bun, Deno, Cloudflare Workers, Next.js App Router, or any
 * Fetch-native runtime — no framework dependency required.
 *
 * @example
 * ```typescript
 * import { CopilotRuntime, createCopilotRuntimeHandler } from "@copilotkitnext/runtime";
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

import type { CopilotRuntime } from "./runtime";
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
import {
  parseMethodCall,
  createJsonRequest,
  expectString,
  type MethodCall,
} from "../endpoints/single-route-helpers";
import { logger } from "@copilotkitnext/shared";

/* ------------------------------------------------------------------------------------------------
 * Public types
 * --------------------------------------------------------------------------------------------- */

export interface CopilotRuntimeHandlerOptions {
  runtime: CopilotRuntime;

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
        // 6. Dispatch
        response = await dispatchSingleRoute(runtime, request, route, methodCall);
      } else {
        // Multi-route: match URL pattern
        const matched = matchRoute(path, basePath);
        if (!matched) {
          return maybeAddCors(
            jsonResponse({ error: "Not found" }, 404),
            corsConfig,
            requestOrigin,
          );
        }

        // Validate HTTP method
        const methodError = validateHttpMethod(request.method, matched);
        if (methodError) {
          return maybeAddCors(methodError, corsConfig, requestOrigin);
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
        response = await dispatchMultiRoute(runtime, request, route);
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
 * Multi-route dispatch
 * --------------------------------------------------------------------------------------------- */

function dispatchMultiRoute(
  runtime: CopilotRuntime,
  request: Request,
  route: RouteInfo,
): Promise<Response> {
  switch (route.method) {
    case "agent/run":
      return handleRunAgent({
        runtime,
        request,
        agentId: route.agentId!,
      });
    case "agent/connect":
      return handleConnectAgent({
        runtime,
        request,
        agentId: route.agentId!,
      });
    case "agent/stop":
      return handleStopAgent({
        runtime,
        request,
        agentId: route.agentId!,
        threadId: route.threadId!,
      });
    case "info":
      return handleGetRuntimeInfo({ runtime, request });
    case "transcribe":
      return handleTranscribe({ runtime, request });
    default:
      throw new Error(`Unknown route method: ${route.method}`);
  }
}

/* ------------------------------------------------------------------------------------------------
 * Single-route dispatch
 * --------------------------------------------------------------------------------------------- */

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
    throw jsonResponse(
      { error: "Method not allowed" },
      405,
      { Allow: "POST" },
    );
  }

  const methodCall = await parseMethodCall(request);

  const route: RouteInfo = { method: methodCall.method };

  if (
    methodCall.method === "agent/run" ||
    methodCall.method === "agent/connect"
  ) {
    route.agentId = expectString(methodCall.params, "agentId");
  } else if (methodCall.method === "agent/stop") {
    route.agentId = expectString(methodCall.params, "agentId");
    route.threadId = expectString(methodCall.params, "threadId");
  }

  return { route, methodCall };
}

function dispatchSingleRoute(
  runtime: CopilotRuntime,
  request: Request,
  route: RouteInfo,
  methodCall: MethodCall,
): Promise<Response> {
  switch (route.method) {
    case "agent/run": {
      const handlerRequest = createJsonRequest(request, methodCall.body);
      return handleRunAgent({
        runtime,
        request: handlerRequest,
        agentId: route.agentId!,
      });
    }
    case "agent/connect": {
      const handlerRequest = createJsonRequest(request, methodCall.body);
      return handleConnectAgent({
        runtime,
        request: handlerRequest,
        agentId: route.agentId!,
      });
    }
    case "agent/stop":
      return handleStopAgent({
        runtime,
        request,
        agentId: route.agentId!,
        threadId: route.threadId!,
      });
    case "info":
      return handleGetRuntimeInfo({ runtime, request });
    case "transcribe": {
      const handlerRequest = createJsonRequest(request, methodCall.body);
      return handleTranscribe({ runtime, request: handlerRequest });
    }
    default:
      throw new Error(`Unknown route method: ${route.method}`);
  }
}

/* ------------------------------------------------------------------------------------------------
 * HTTP method validation
 * --------------------------------------------------------------------------------------------- */

function validateHttpMethod(
  httpMethod: string,
  route: RouteInfo,
): Response | null {
  const method = httpMethod.toUpperCase();
  if (route.method === "info" && method === "GET") return null;
  if (route.method !== "info" && method === "POST") return null;
  const allowed = route.method === "info" ? "GET" : "POST";
  return jsonResponse(
    { error: "Method not allowed" },
    405,
    { Allow: allowed },
  );
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
