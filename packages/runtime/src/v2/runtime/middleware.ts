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
import type { MaybePromise } from "@copilotkit/shared";
import { logger } from "@copilotkit/shared";
import { parseSSEResponse } from "./middleware-sse-parser";
import type { Message } from "./middleware-sse-parser";

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
  /** Reconstructed messages from the SSE stream (empty for non-SSE responses). */
  messages?: Message[];
  /** Thread ID extracted from the RUN_STARTED event. */
  threadId?: string;
  /** Run ID extracted from the RUN_STARTED event. */
  runId?: string;
}

export type BeforeRequestMiddlewareFn = (
  params: BeforeRequestMiddlewareParameters,
) => MaybePromise<Request | void>;
export type AfterRequestMiddlewareFn = (
  params: AfterRequestMiddlewareParameters,
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
}: {
  runtime: CopilotRuntime;
  response: Response;
  path: string;
}): Promise<void> {
  const mw = runtime.afterRequestMiddleware;
  if (!mw) return;

  const { messages, threadId, runId } = await parseSSEResponse(response);

  if (typeof mw === "function") {
    return (mw as AfterRequestMiddlewareFn)({
      runtime,
      response,
      path,
      messages,
      threadId,
      runId,
    });
  }

  logger.warn({ mw }, "Unsupported afterRequestMiddleware value – skipped");
}
