import type { IncomingMessage, ServerResponse } from "node:http";
import type { Plugin } from "vite";
import { intelligenceExportFixture } from "./intelligence-export-fixtures.js";
import type { IntelligenceReadRequest } from "../src/lib/intelligence-relay.js";
import { intelligenceFixture } from "./intelligence-state-lab.js";

/** Reads a small local fixture request and rejects malformed envelopes. */
async function respond(
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  let bytes = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
    bytes += buffer.length;
    if (bytes > 65536) {
      response.writeHead(413).end();
      return;
    }
    chunks.push(buffer);
  }
  const input: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  if (
    typeof input !== "object" ||
    input === null ||
    !("method" in input) ||
    !("path" in input) ||
    !["GET", "POST"].includes(String(input.method)) ||
    typeof input.path !== "string"
  ) {
    response.writeHead(400).end();
    return;
  }
  const query: Record<string, string> = {};
  if (
    "query" in input &&
    typeof input.query === "object" &&
    input.query !== null
  ) {
    for (const [key, value] of Object.entries(input.query))
      if (typeof value === "string") query[key] = value;
  }
  const read: IntelligenceReadRequest = {
    method: input.method === "GET" ? "GET" : "POST",
    path: input.path,
    query,
    ...("body" in input ? { body: input.body } : {}),
  };
  const exported = intelligenceExportFixture(read);
  if (exported?.contentType) {
    response
      .writeHead(exported.status, {
        "Content-Type": exported.contentType,
        "Cache-Control": "no-store",
        "X-Export-Metadata": JSON.stringify(exported.metadata),
      })
      .end(String(exported.body));
    return;
  }
  const result = exported ?? intelligenceFixture(read);
  response
    .writeHead(result.status, {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    })
    .end(JSON.stringify(result.body));
}

/** Adds fixture reads only to the local Vite workbench, never the published package. */
export function createIntelligenceStateLabPlugin() {
  return {
    name: "inspector-intelligence-fixture",
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        if (
          request.method !== "POST" ||
          !request.url?.split("?")[0]?.endsWith("/inspector-intelligence")
        ) {
          next();
          return;
        }
        respond(request, response).catch(() => {
          if (!response.headersSent) response.writeHead(400);
          response.end();
        });
      });
    },
  } satisfies Plugin;
}
