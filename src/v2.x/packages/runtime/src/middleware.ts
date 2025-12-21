/**
 * Middleware support for CopilotKit Runtime.
 *
 * A middleware hook can be provided as either:
 *   1. A **callback function** executed in-process.
 *   2. A **webhook URL** (http/https).  The runtime will `POST` a JSON payload
 *      to the URL and, for *before* hooks, accept an optional modified
 *      `Request` object in the response body.
 *
 * Two lifecycle hooks are available:
 *   • `BEFORE_REQUEST` – runs *before* the request handler.
 *   • `AFTER_REQUEST`  – runs *after* the handler returns a `Response`.
 */

import type { CopilotRuntime } from "./runtime";
import type { MaybePromise } from "@copilotkitnext/shared";
import { logger } from "@copilotkitnext/shared";

/* ------------------------------------------------------------------------------------------------
 * Public types
 * --------------------------------------------------------------------------------------------- */

export interface BeforeRequestMiddlewareParameters {
  runtime: CopilotRuntime;
  request: Request;
  path: string;
}
export interface AfterRequestMiddlewareParameters {
  runtime: CopilotRuntime;
  response: Response;
  path: string;
}

export type BeforeRequestMiddlewareFn = (
  params: BeforeRequestMiddlewareParameters
) => MaybePromise<Request | void>;
export type AfterRequestMiddlewareFn = (
  params: AfterRequestMiddlewareParameters
) => MaybePromise<void>;

/**
 * A middleware value can be either a callback function or a webhook URL.
 */
export type BeforeRequestMiddleware = BeforeRequestMiddlewareFn;
export type AfterRequestMiddleware = AfterRequestMiddlewareFn;

/** Lifecycle events emitted to webhook middleware. */
export enum CopilotKitMiddlewareEvent {
  BeforeRequest = "BEFORE_REQUEST",
  AfterRequest = "AFTER_REQUEST",
}

/** Stages used by the Middleware Webhook Protocol */
/** Stages used by the CopilotKit webhook protocol */
export enum WebhookStage {
  BeforeRequest = "before_request",
  AfterRequest = "after_request",
}

/* ------------------------------------------------------------------------------------------------
 * Internal helpers – (de)serialisation
 * --------------------------------------------------------------------------------------------- */

export async function callBeforeRequestMiddleware({
  runtime,
  request,
  path,
}: BeforeRequestMiddlewareParameters): Promise<Request | void> {
  const mw = runtime.beforeRequestMiddleware;
  if (!mw) return;

  // Function-based middleware (in-process)
  if (typeof mw === "function") {
    return (mw as BeforeRequestMiddlewareFn)({ runtime, request, path });
  }

  logger.warn({ mw }, "Unsupported beforeRequestMiddleware value – skipped");
  return;
}

export async function callAfterRequestMiddleware({
  runtime,
  response,
  path,
}: AfterRequestMiddlewareParameters): Promise<void> {
  const mw = runtime.afterRequestMiddleware;
  if (!mw) return;

  if (typeof mw === "function") {
    return (mw as AfterRequestMiddlewareFn)({ runtime, response, path });
  }

  logger.warn({ mw }, "Unsupported afterRequestMiddleware value – skipped");
}
