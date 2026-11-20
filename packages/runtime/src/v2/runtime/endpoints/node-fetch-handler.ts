/**
 * Generic Node ↔ Fetch bridge for CopilotKit runtime.
 *
 * Wraps a `CopilotRuntimeFetchHandler` as a Node HTTP handler using
 * `@remix-run/node-fetch-server` for reliable streaming and conversion.
 *
 * When body-parsing middleware (Express `express.json()`, NestJS's default
 * parser, …) runs first, the Node request stream is already consumed and
 * `req.body` holds the parsed content. Reading the exhausted stream would hang,
 * so that case re-serialises `req.body` into the Fetch `Request` instead.
 *
 * @example
 * ```typescript
 * import { createServer } from "node:http";
 * import { createCopilotRuntimeHandler } from "@copilotkit/runtime/v2";
 * import { createCopilotNodeHandler } from "@copilotkit/runtime/v2/node";
 *
 * const handler = createCopilotRuntimeHandler({ runtime, basePath: "/api/copilotkit", cors: true });
 * const nodeHandler = createCopilotNodeHandler(handler);
 * createServer(nodeHandler).listen(3000);
 * ```
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import {
  createHeaders,
  createRequest,
  sendResponse,
} from "@remix-run/node-fetch-server";
import type { CopilotRuntimeFetchHandler } from "../core/fetch-handler";
import { logger } from "@copilotkit/shared";

const METHODS_WITHOUT_BODY = new Set(["GET", "HEAD", "OPTIONS"]);

export type NodeFetchHandler = (
  req: IncomingMessage,
  res: ServerResponse,
) => Promise<void>;

export function createCopilotNodeHandler(
  handler: CopilotRuntimeFetchHandler,
): NodeFetchHandler {
  return async (req: IncomingMessage, res: ServerResponse) => {
    try {
      const method = (req.method ?? "GET").toUpperCase();
      const fetchReq =
        !METHODS_WITHOUT_BODY.has(method) && hasPreParsedBody(req)
          ? buildPreParsedRequest(req, res)
          : createRequest(req, res);
      const fetchRes = await handler(fetchReq);
      await sendResponse(res, fetchRes);
    } catch (err: unknown) {
      logger.error({ err }, "Error in Node fetch handler");
      if (!res.headersSent) {
        res.statusCode = 500;
        res.end("Internal Server Error");
      }
    }
  };
}

/** @deprecated Use `createCopilotNodeHandler` instead. */
export const createNodeFetchHandler = createCopilotNodeHandler;

/**
 * Build a Fetch Request from a Node IncomingMessage whose body stream has
 * already been consumed by a body parser.
 *
 * The URL, headers and abort wiring match `createRequest` (the streaming path),
 * so a request routes the same way whether or not a parser ran first. In
 * particular the URL comes from `req.url`, which is what a mounting router
 * matched against; `originalUrl` still carries the mount prefix and would miss
 * the handler's `basePath`.
 */
function buildPreParsedRequest(
  req: IncomingMessage & { body?: unknown },
  res: ServerResponse,
): Request {
  const method = (req.method ?? "GET").toUpperCase();
  const headers = createHeaders(req);
  const protocol =
    "encrypted" in req.socket && req.socket.encrypted ? "https:" : "http:";
  const host = headers.get("host") ?? "localhost";
  const url = new URL(req.url ?? "/", `${protocol}//${host}`);

  // Wire an AbortSignal so client disconnects propagate to the fetch handler
  const controller = new AbortController();
  res.on("close", () => {
    if (!res.writableFinished) controller.abort();
  });

  const init: RequestInit = {
    method,
    headers,
    signal: controller.signal,
  };

  const { body, contentType } = synthesizeBody(req.body);
  if (contentType) {
    headers.set("content-type", contentType);
  }
  headers.delete("content-length");
  if (body !== undefined) {
    init.body = body;
  }

  return new Request(url, init);
}

function hasPreParsedBody(req: IncomingMessage & { body?: unknown }): boolean {
  if (req.body === undefined || req.body === null) return false;

  // Only `readableEnded` means "a parser drained this stream to its end".
  // `req.complete` and the private `_readableState.ended` are set by the HTTP
  // parser once the socket has all the bytes, whether or not anything read them.
  //
  // That distinction matters because `req.body` being set does not prove a parser
  // ran: body-parser 1.x (Express 4) assigns `req.body = req.body || {}` before
  // its own content-type checks, so a request it declines to parse — multipart
  // upload, text/plain — reaches us with `req.body === {}` and a full, unread
  // stream. Treating that as pre-parsed rebuilt the request from `{}` and
  // dropped the real payload.
  return Boolean(req.readableEnded);
}

function synthesizeBody(body: unknown): {
  body?: BodyInit;
  contentType?: string;
} {
  if (Buffer.isBuffer(body) || body instanceof Uint8Array) {
    // Buffer/Uint8Array<ArrayBufferLike> are valid fetch bodies at runtime,
    // but the DOM lib's BodyInit only admits ArrayBuffer-backed views.
    return { body: body as BodyInit };
  }
  if (typeof body === "string") {
    return { body };
  }
  if (typeof body === "object" && body !== null) {
    return { body: JSON.stringify(body), contentType: "application/json" };
  }
  return {};
}
