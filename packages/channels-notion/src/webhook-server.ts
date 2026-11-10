import { createServer } from "node:http";
import type { IncomingMessage, Server, ServerResponse } from "node:http";

/** Options for {@link NotionWebhookServer}. */
export interface NotionWebhookServerOptions {
  /** Fetch-style handler that serves the webhook path, from `createWebhookHandler`. */
  handler: (request: Request) => Promise<Response>;
  /** Webhook path (default "/webhook"). */
  path?: string;
}

const BODYLESS_METHODS = new Set(["GET", "HEAD"]);

/** Largest request body the server reads. Notion events are small JSON objects. */
const MAX_BODY_BYTES = 1024 * 1024;

/**
 * Buffers the request body. Resolves `null` as soon as the body grows past
 * {@link MAX_BODY_BYTES}, and keeps no more of it.
 */
function readBody(req: IncomingMessage) {
  return new Promise<Buffer | null>((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        chunks.length = 0;
        resolve(null);
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function toRequest(req: IncomingMessage, url: URL, body: Buffer) {
  const headers = new Headers();
  const entries = Object.entries(req.headers);
  for (const [name, value] of entries) {
    if (value === undefined) continue;
    const values = Array.isArray(value) ? value : [value];
    for (const item of values) headers.append(name, item);
  }
  const method = req.method ?? "GET";
  if (BODYLESS_METHODS.has(method)) {
    return new Request(url, { method, headers });
  }
  return new Request(url, { method, headers, body: new Uint8Array(body) });
}

/** Answers 413 and closes the connection, so the client stops sending. */
function rejectTooLarge(res: ServerResponse) {
  res.statusCode = 413;
  res.setHeader("connection", "close");
  res.end();
}

async function sendResponse(response: Response, res: ServerResponse) {
  res.statusCode = response.status;
  response.headers.forEach((value, name) => res.setHeader(name, value));
  res.end(Buffer.from(await response.arrayBuffer()));
}

/**
 * A `node:http` server for the Notion webhook.
 *
 * It serves the given fetch-style handler at `path`, answers `GET /` with
 * 200 "ok" as a health check (when `path` is not "/"), and returns 404 for
 * every other path. A request body over 1 MiB gets 413.
 *
 * ```ts
 * const server = new NotionWebhookServer({ handler: createWebhookHandler({ ... }) });
 * await server.start(3000);
 * // later
 * await server.stop();
 * ```
 */
export class NotionWebhookServer {
  private readonly handler: (request: Request) => Promise<Response>;
  private readonly path: string;
  private server: Server | undefined;

  /**
   * @param options.handler - Handler for requests to `path`.
   * @param options.path - Webhook path (default "/webhook").
   */
  constructor(options: NotionWebhookServerOptions) {
    this.handler = options.handler;
    this.path = options.path ?? "/webhook";
  }

  /** The bound address, or `null` when the server is not listening. */
  address() {
    const address = this.server?.address();
    return typeof address === "object" && address !== null ? address : null;
  }

  /**
   * Starts listening. Resolves once the port is bound.
   *
   * @param port - Port to listen on. Use 0 for a free port.
   * @param host - Host to bind (default: all interfaces).
   */
  async start(port: number, host?: string) {
    const server = createServer((req, res) => {
      void this.handle(req, res);
    });
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(port, host, () => {
        server.off("error", reject);
        resolve();
      });
    });
    this.server = server;
  }

  /** Stops the server. Does nothing when it is not running. */
  async stop() {
    const server = this.server;
    if (!server) return;
    this.server = undefined;
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }

  private async handle(req: IncomingMessage, res: ServerResponse) {
    const url = new URL(req.url ?? "/", "http://localhost");
    const isHealthCheck =
      req.method === "GET" && url.pathname === "/" && this.path !== "/";
    if (isHealthCheck) {
      res.statusCode = 200;
      res.setHeader("content-type", "text/plain");
      res.end("ok");
      return;
    }
    if (url.pathname !== this.path) {
      res.statusCode = 404;
      res.end();
      return;
    }
    const declaredLength = Number(req.headers["content-length"]);
    if (declaredLength > MAX_BODY_BYTES) {
      rejectTooLarge(res);
      return;
    }
    try {
      const body = await readBody(req);
      if (body === null) {
        rejectTooLarge(res);
        return;
      }
      const response = await this.handler(toRequest(req, url, body));
      await sendResponse(response, res);
    } catch (error) {
      console.error("[channels-notion] webhook request failed:", error);
      if (!res.headersSent) res.statusCode = 500;
      res.end();
    }
  }
}
