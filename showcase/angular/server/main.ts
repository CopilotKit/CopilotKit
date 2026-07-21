import { createReadStream } from "node:fs";
import { access, stat } from "node:fs/promises";
import { createServer } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import { dirname, extname, join, normalize } from "node:path";
import { Readable } from "node:stream";
import { fileURLToPath } from "node:url";

import frontendCatalogData from "./generated/frontend-catalog.json" with { type: "json" };
import registryData from "./generated/registry.json" with { type: "json" };
import { createHostErrorResponse, createHostHandler } from "./host-handler.js";
import { readHostConfig } from "./host-config.js";
import { createProxyHandler } from "./proxy-handler.js";
import type { ProxyLogEvent } from "./proxy-handler.js";
import { buildRuntimeIndex } from "./proxy-policy.js";
import type {
  RuntimeCatalogInput,
  RuntimeRegistryInput,
} from "./proxy-policy.js";

const config = readHostConfig(process.env);
const runtimeIndex = buildRuntimeIndex(
  registryData as RuntimeRegistryInput,
  frontendCatalogData as RuntimeCatalogInput,
);
const browserRoot = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../showcase-angular/browser",
);

function log(event: ProxyLogEvent | Record<string, unknown>): void {
  console.log(
    JSON.stringify({ timestamp: new Date().toISOString(), ...event }),
  );
}

const proxy = createProxyHandler({
  index: runtimeIndex,
  backendHostPattern: config.backendHostPattern,
  production: config.production,
  log,
});

const CONTENT_TYPES: Readonly<Record<string, string>> = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

async function staticResponse(pathname: string): Promise<Response | undefined> {
  const candidate = pathname === "/" ? "/index.html" : pathname;
  const normalized = normalize(candidate).replace(/^[/\\]+/, "");
  if (normalized.includes("..") || normalized.includes("\\")) return undefined;
  const filePath = join(browserRoot, normalized);
  try {
    const info = await stat(filePath);
    if (!info.isFile()) return undefined;
    await access(filePath);
    return new Response(
      Readable.toWeb(createReadStream(filePath)) as ReadableStream,
      {
        headers: {
          "content-type":
            CONTENT_TYPES[extname(filePath).toLowerCase()] ??
            "application/octet-stream",
        },
      },
    );
  } catch {
    return undefined;
  }
}

const handleRequest = createHostHandler({
  config,
  runtimeIndex,
  proxy,
  serveStatic: staticResponse,
  commitSha: process.env.COMMIT_SHA,
});

async function readRequestBody(
  request: IncomingMessage,
): Promise<Buffer | undefined> {
  if (request.method === "GET" || request.method === "HEAD") return undefined;
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > 10 * 1024 * 1024) {
      throw new Error("request-body-too-large");
    }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
}

async function webRequest(
  request: IncomingMessage,
  signal: AbortSignal,
): Promise<Request> {
  const headers = new Headers();
  for (const [name, value] of Object.entries(request.headers)) {
    if (Array.isArray(value)) {
      for (const item of value) headers.append(name, item);
    } else if (value !== undefined) {
      headers.set(name, value);
    }
  }
  const body = await readRequestBody(request);
  return new Request(`http://angular-showcase.internal${request.url ?? "/"}`, {
    method: request.method,
    headers,
    body: body === undefined ? undefined : Uint8Array.from(body),
    signal,
  });
}

async function sendResponse(
  response: Response,
  target: ServerResponse,
): Promise<void> {
  target.statusCode = response.status;
  target.statusMessage = response.statusText;
  response.headers.forEach((value, name) => target.setHeader(name, value));
  if (!response.body) {
    target.end();
    return;
  }
  await new Promise<void>((resolve, reject) => {
    const body = Readable.fromWeb(response.body as never);
    body.once("error", reject);
    target.once("finish", resolve);
    body.pipe(target);
  });
}

const server = createServer((incoming, outgoing) => {
  const abortController = new AbortController();
  incoming.once("aborted", () => abortController.abort());
  outgoing.once("close", () => {
    if (!outgoing.writableFinished) abortController.abort();
  });
  void (async () => {
    try {
      await sendResponse(
        await handleRequest(await webRequest(incoming, abortController.signal)),
        outgoing,
      );
    } catch (error) {
      if (outgoing.destroyed) return;
      const tooLarge =
        error instanceof Error && error.message === "request-body-too-large";
      log({
        event: "angular_host_request_failed",
        status: tooLarge ? 413 : 500,
      });
      await sendResponse(
        createHostErrorResponse(
          config,
          tooLarge ? "request-too-large" : "internal-error",
          "The request could not be served.",
          tooLarge ? 413 : 500,
        ),
        outgoing,
      );
    }
  })();
});

server.listen(config.port, "0.0.0.0", () => {
  log({
    event: "angular_host_ready",
    port: config.port,
    frontend: "angular",
    backendConfig: config.backendConfigStatus,
    runnableCells: [...runtimeIndex.values()].filter((entry) => entry.runnable)
      .length,
  });
});
