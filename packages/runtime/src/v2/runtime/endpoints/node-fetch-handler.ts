/**
 * Generic Node ↔ Fetch bridge for CopilotKit runtime.
 *
 * Wraps a `CopilotRuntimeFetchHandler` as a Node HTTP handler using
 * `@remix-run/node-fetch-server` for reliable streaming and conversion.
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
import { createRequest, sendResponse } from "@remix-run/node-fetch-server";
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
    const method = (req.method ?? "GET").toUpperCase();

    try {
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

/**
 * Build a Fetch Request from a Node IncomingMessage whose body stream has
 * already been consumed by body-parsing middleware (e.g. NestJS or Express).
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

/** @deprecated Use `createCopilotNodeHandler` instead. */
export const createNodeFetchHandler = createCopilotNodeHandler;
