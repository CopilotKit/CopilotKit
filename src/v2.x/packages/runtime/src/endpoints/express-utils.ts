import type { Request as ExpressRequest, Response as ExpressResponse } from "express";
import { Readable } from "node:stream";
import { pipeline } from "node:stream";
import { promisify } from "node:util";
import { logger } from "@copilotkitnext/shared";

const streamPipeline = promisify(pipeline);

const METHODS_WITHOUT_BODY = new Set(["GET", "HEAD"]);

export function createFetchRequestFromExpress(req: ExpressRequest): Request {
  const method = req.method?.toUpperCase() ?? "GET";
  const origin = buildOrigin(req);
  const url = `${origin}${req.originalUrl ?? req.url ?? ""}`;

  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      value.forEach((v) => headers.append(key, v));
    } else {
      headers.set(key, value);
    }
  }

  const init: RequestInit & { duplex?: "half" } = {
    method,
    headers,
  };

  const hasParsedBody = req.body !== undefined && req.body !== null;
  const streamConsumed = isStreamConsumed(req, hasParsedBody);

  if (!METHODS_WITHOUT_BODY.has(method)) {
    const canStreamBody = req.readable !== false && !streamConsumed;

    if (canStreamBody) {
      init.body = Readable.toWeb(req) as unknown as BodyInit;
      init.duplex = "half";
    } else if (hasParsedBody) {
      const { body, contentType } = synthesizeBody(req.body);
      if (contentType) {
        headers.set("content-type", contentType);
      }
      headers.delete("content-length");
      if (body !== undefined) {
        init.body = body;
      }
      logger.info(
        {
          url,
          method,
          readable: req.readable,
          readableEnded: req.readableEnded,
          complete: req.complete,
        },
        "Express request stream already consumed; synthesized body from parsed content",
      );
    } else {
      headers.delete("content-length");
      logger.warn(
        { url, method },
        "Request stream already consumed but no body was available; sending empty body",
      );
    }
  }

  const controller = new AbortController();
  req.on("close", () => controller.abort());
  init.signal = controller.signal;

  try {
    return new Request(url, init);
  } catch (error) {
    if (error instanceof TypeError && /disturbed|locked/i.test(error.message)) {
      // Fallback to synthesized/empty body when the stream was already consumed.
      headers.delete("content-length");
      delete init.duplex;

      if (hasParsedBody) {
        const { body, contentType } = synthesizeBody(req.body);
        if (contentType) {
          headers.set("content-type", contentType);
        }
        init.body = body;
        logger.info(
          { url, method },
          "Request stream disturbed while constructing Request; reused parsed body",
        );
      } else {
        init.body = undefined;
        logger.warn(
          { url, method },
          "Request stream was disturbed; falling back to empty body",
        );
      }

      return new Request(url, init);
    }
    throw error;
  }
}

export async function sendFetchResponse(res: ExpressResponse, response: Response): Promise<void> {
  res.status(response.status);

  response.headers.forEach((value, key) => {
    if (key.toLowerCase() === "content-length" && response.body !== null) {
      return;
    }
    res.setHeader(key, value);
  });

  if (!response.body) {
    res.end();
    return;
  }

  const nodeStream = Readable.fromWeb(response.body as unknown as ReadableStream<Uint8Array>);
  try {
    await streamPipeline(nodeStream, res);
  } catch (error) {
    res.destroy(error as Error);
    throw error;
  }
}

function buildOrigin(req: ExpressRequest): string {
  const protocol = req.protocol || (req.secure ? "https" : "http");
  const host = req.get("host") ?? "localhost";
  return `${protocol}://${host}`;
}

function isStreamConsumed(req: ExpressRequest, hasParsedBody: boolean): boolean {
  const state = (req as unknown as { _readableState?: { ended?: boolean; endEmitted?: boolean } })
    ._readableState;
  return Boolean(
    hasParsedBody ||
      req.readableEnded ||
      req.complete ||
      state?.ended ||
      state?.endEmitted,
  );
}

function synthesizeBody(body: unknown): { body?: BodyInit; contentType?: string } {
  if (Buffer.isBuffer(body) || body instanceof Uint8Array) {
    return { body };
  }

  if (typeof body === "string") {
    return { body };
  }

  if (typeof body === "object" && body !== undefined) {
    return { body: JSON.stringify(body), contentType: "application/json" };
  }

  return {};
}
