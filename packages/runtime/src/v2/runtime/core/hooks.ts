/**
 * Lifecycle hooks for CopilotKit runtime request processing.
 *
 * Hooks let you intercept requests at various stages of the pipeline:
 * - `onRequest`: Before routing — auth, correlation IDs, header injection
 * - `onBeforeHandler`: After routing — route-specific authorization
 * - `onResponse`: After handler — add headers, log, set cookies
 * - `onError`: On error — custom error responses
 *
 * @example
 * ```typescript
 * const handler = createCopilotRuntimeHandler({
 *   runtime,
 *   hooks: {
 *     onRequest: async ({ request }) => {
 *       const token = request.headers.get("authorization");
 *       if (!token) throw new Response("Unauthorized", { status: 401 });
 *     },
 *     onResponse: async ({ response }) => {
 *       const headers = new Headers(response.headers);
 *       headers.set("x-copilot-version", "2.0");
 *       return new Response(response.body, { ...response, headers });
 *     },
 *   },
 * });
 * ```
 */

import type { MaybePromise } from "@copilotkit/shared";
import type { CopilotRuntimeLike } from "./runtime";

/* ------------------------------------------------------------------------------------------------
 * Route info
 * --------------------------------------------------------------------------------------------- */

export type RouteInfo =
  | { method: "agent/run"; agentId: string }
  | { method: "agent/connect"; agentId: string }
  | { method: "agent/stop"; agentId: string; threadId: string }
  | { method: "info" }
  | { method: "transcribe" }
  | { method: "threads/list" }
  | { method: "threads/subscribe" }
  | { method: "threads/update"; threadId: string }
  | { method: "threads/archive"; threadId: string }
  | { method: "threads/messages"; threadId: string }
  | { method: "threads/clear" }
  | { method: "cpk-debug-events" };

/* ------------------------------------------------------------------------------------------------
 * Hook contexts
 * --------------------------------------------------------------------------------------------- */

export interface HookContext {
  /** The incoming Fetch Request (possibly modified by prior hooks). */
  request: Request;
  /** The resolved URL pathname. */
  path: string;
  /** The CopilotRuntimeLike instance. */
  runtime: CopilotRuntimeLike;
}

export interface HandlerHookContext extends HookContext {
  /** The resolved route information. */
  route: RouteInfo;
}

export interface ResponseHookContext extends HookContext {
  /** The Response produced by the handler. */
  response: Response;
  /** The resolved route information. */
  route: RouteInfo;
}

export interface ErrorHookContext extends HookContext {
  /** The error that occurred. */
  error: unknown;
  /** The route info, if routing had already succeeded. */
  route?: RouteInfo;
}

/* ------------------------------------------------------------------------------------------------
 * Hooks interface
 * --------------------------------------------------------------------------------------------- */

export interface CopilotRuntimeHooks {
  /**
   * Called at the start of every request, before routing.
   * Use to validate auth, attach headers, initialize correlation IDs, etc.
   *
   * Return a modified Request to replace the original, or void to continue.
   * Throw a Response to short-circuit with an early response.
   */
  onRequest?: (ctx: HookContext) => MaybePromise<Request | void>;

  /**
   * Called after routing is resolved but before the handler executes.
   * Receives the resolved route info (method, agentId, threadId).
   *
   * Use to do route-specific authorization, attach headers for agent calls, etc.
   * Return a modified Request or void.
   * Throw a Response to short-circuit.
   */
  onBeforeHandler?: (ctx: HandlerHookContext) => MaybePromise<Request | void>;

  /**
   * Called after the handler produces a Response, before it's sent to the client.
   * Use to set cookies, add debugging headers, log, etc.
   *
   * Return a modified Response to replace the original, or void.
   */
  onResponse?: (ctx: ResponseHookContext) => MaybePromise<Response | void>;

  /**
   * Called when an error occurs during request processing.
   * Return a Response to override the default error response, or void to use the default.
   */
  onError?: (ctx: ErrorHookContext) => MaybePromise<Response | void>;
}

/* ------------------------------------------------------------------------------------------------
 * Internal hook runners
 * --------------------------------------------------------------------------------------------- */

export async function runOnRequest(
  hooks: CopilotRuntimeHooks | undefined,
  ctx: HookContext,
): Promise<Request> {
  if (!hooks?.onRequest) return ctx.request;
  const result = await hooks.onRequest(ctx);
  return result instanceof Request ? result : ctx.request;
}

export async function runOnBeforeHandler(
  hooks: CopilotRuntimeHooks | undefined,
  ctx: HandlerHookContext,
): Promise<Request> {
  if (!hooks?.onBeforeHandler) return ctx.request;
  const result = await hooks.onBeforeHandler(ctx);
  return result instanceof Request ? result : ctx.request;
}

export async function runOnResponse(
  hooks: CopilotRuntimeHooks | undefined,
  ctx: ResponseHookContext,
): Promise<Response> {
  if (!hooks?.onResponse) return ctx.response;
  const result = await hooks.onResponse(ctx);
  return result instanceof Response ? result : ctx.response;
}

export async function runOnError(
  hooks: CopilotRuntimeHooks | undefined,
  ctx: ErrorHookContext,
): Promise<Response | void> {
  if (!hooks?.onError) return;
  return hooks.onError(ctx);
}
