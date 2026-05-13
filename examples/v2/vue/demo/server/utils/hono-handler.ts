import { Readable } from "node:stream";
import {
  defineEventHandler,
  getRequestHeaders,
  getRequestURL,
  readRawBody,
  sendStream,
  setResponseStatus,
} from "h3";
import type { Hono } from "hono";

const NO_BODY_METHODS = new Set(["GET", "HEAD"]);

export function defineHonoEventHandler(app: Hono) {
  return defineEventHandler(async (event) => {
    const method = event.method?.toUpperCase() ?? "GET";
    const headers = new Headers();
    const requestHeaders = getRequestHeaders(event);

    for (const [key, value] of Object.entries(requestHeaders)) {
      if (value === undefined) continue;
      if (Array.isArray(value)) {
        for (const item of value) {
          if (typeof item === "string") {
            headers.append(key, item);
          }
        }
        continue;
      }
      if (typeof value === "string") {
        headers.set(key, value);
      }
    }

    const body = NO_BODY_METHODS.has(method)
      ? undefined
      : ((await readRawBody(event, false)) as BodyInit | undefined);

    const request = new Request(getRequestURL(event).toString(), {
      method,
      headers,
      body,
    });

    const response = await app.fetch(request);

    setResponseStatus(event, response.status, response.statusText);
    response.headers.forEach((value, key) => {
      event.node.res.setHeader(key, value);
    });

    if (!response.body) {
      return await response.text();
    }

    return sendStream(
      event,
      Readable.fromWeb(response.body as globalThis.ReadableStream<Uint8Array>),
    );
  });
}
