/**
 * Express-aware Node ↔ Fetch bridge.
 *
 * When Express body-parsing middleware (e.g. `express.json()`) runs before the
 * CopilotKit router, the Node request stream is already consumed and `req.body`
 * holds the parsed content. The generic `createCopilotNodeHandler` (which uses
 * `@remix-run/node-fetch-server`) would hang because it tries to read from the
 * exhausted stream.
 *
 * This module detects the pre-parsed case and re-serialises `req.body` into the
 * Fetch `Request`, falling back to the generic `createCopilotNodeHandler` when the
 * stream is still available.
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import { sendResponse } from "@remix-run/node-fetch-server";
import { createCopilotNodeHandler } from "./node-fetch-handler";
import type { CopilotRuntimeFetchHandler } from "../core/fetch-handler";
import { logger } from "@copilotkit/shared";

const METHODS_WITHOUT_BODY = new Set(["GET", "HEAD", "OPTIONS"]);

export type ExpressNodeHandler = (
  req: IncomingMessage,
  res: ServerResponse,
) => Promise<void>;

/**
 * Creates a Node HTTP handler from a fetch handler, with Express body-parser
 * compatibility. Use this instead of `createNodeFetchHandler` in Express adapters.
 *
 * When the body stream hasn't been consumed, delegates to the generic
 * `createCopilotNodeHandler`. Only intercepts when Express middleware has
 * pre-parsed the body.
 */
export function createExpressNodeHandler(
  handler: CopilotRuntimeFetchHandler,
): ExpressNodeHandler {
  const nodeHandler = createCopilotNodeHandler(handler);

  return async (req: IncomingMessage, res: ServerResponse) => {
    const method = (req.method ?? "GET").toUpperCase();

    // Fast path: if no body parser consumed the stream, use the generic handler.
    if (METHODS_WITHOUT_BODY.has(method) || !hasPreParsedBody(req)) {
      return nodeHandler(req, res);
    }

    // Slow path: body was consumed by Express middleware — rebuild the Request.
    try {
      const fetchReq = buildPreParsedRequest(req, res);
      const fetchRes = await handler(fetchReq);
      await sendResponse(res, fetchRes);
    } catch (err: unknown) {
      logger.error({ err }, "Error in Express fetch bridge (pre-parsed path)");
      if (!res.headersSent) {
        res.statusCode = 500;
        res.end("Internal Server Error");
      }
    }
  };
}

/**
 * Build a Fetch Request from a Node IncomingMessage whose body stream has
 * already been consumed by an Express body parser.
 */
function buildPreParsedRequest(
  req: IncomingMessage,
  res: ServerResponse,
): Request {
  const expressReq = req as IncomingMessage & { body?: unknown };
  const method = (req.method ?? "GET").toUpperCase();

  const protocol = (req as any).protocol || "http";
  const host = req.headers.host ?? "localhost";
  const url = `${protocol}://${host}${(req as any).originalUrl ?? req.url ?? ""}`;

  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      for (const v of value) headers.append(key, v);
    } else {
      headers.set(key, value);
    }
  }

  // Wire an AbortSignal so client disconnects propagate to the fetch handler
  const controller = new AbortController();
  res.on("close", () => {
    if (!res.writableFinished) controller.abort();
  });

  const init: RequestInit & { duplex?: "half" } = {
    method,
    headers,
    signal: controller.signal,
  };

  const { body, contentType } = synthesizeBody(expressReq.body);
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

  // Check if the stream has already been consumed.
  const state = (req as any)._readableState;
  return Boolean(
    req.readableEnded || req.complete || state?.ended || state?.endEmitted,
  );
}

function synthesizeBody(body: unknown): {
  body?: BodyInit;
  contentType?: string;
} {
  if (Buffer.isBuffer(body) || body instanceof Uint8Array) {
    return { body };
  }
  if (typeof body === "string") {
    return { body };
  }
  if (typeof body === "object" && body !== null) {
    return { body: JSON.stringify(body), contentType: "application/json" };
  }
  return {};
}
