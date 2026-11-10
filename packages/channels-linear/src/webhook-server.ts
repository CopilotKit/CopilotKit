import { createServer } from "node:http";
import type { IncomingMessage, Server, ServerResponse } from "node:http";
import type { createWebhookHandler } from "./webhook.js";

export interface LinearWebhookServerOptions {
  /** The handler from `createWebhookHandler`. The server only routes to it. */
  handler: ReturnType<typeof createWebhookHandler>;
  /** Path that receives Linear webhooks (default "/webhook"). */
  path?: string;
}

async function readBody(req: IncomingMessage) {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

/** Bridges a node:http request to a fetch `Request`, keeping the raw body bytes. */
async function toRequest(req: IncomingMessage, url: URL) {
  const method = req.method ?? "GET";
  const headers = new Headers();
  const entries = Object.entries(req.headersDistinct);
  for (const [name, values] of entries) {
    for (const value of values ?? []) headers.append(name, value);
  }
  const hasBody = method !== "GET" && method !== "HEAD";
  const body = hasBody ? new Uint8Array(await readBody(req)) : undefined;
  return new Request(url, { method, headers, body });
}

/** Writes a fetch `Response` to a node:http response. */
async function writeResponse(response: Response, res: ServerResponse) {
  res.statusCode = response.status;
  response.headers.forEach((value, name) => res.setHeader(name, value));
  res.end(Buffer.from(await response.arrayBuffer()));
}

/**
 * Optional built-in `node:http` server around a Linear webhook handler.
 *
 * Routes:
 * - `path` (default "/webhook"): the handler.
 * - `GET /`: health check, 200 "ok". Only when `path` is not "/".
 * - anything else: 404.
 *
 * @example
 * ```ts
 * const server = new LinearWebhookServer({ handler: createWebhookHandler({ ... }) });
 * await server.start(3000);
 * ```
 */
export class LinearWebhookServer {
  private readonly handler: LinearWebhookServerOptions["handler"];
  private readonly path: string;
  private server: Server | undefined;

  constructor(options: LinearWebhookServerOptions) {
    this.handler = options.handler;
    this.path = options.path ?? "/webhook";
  }

  /** The bound address, or `null` when the server is not listening. */
  address() {
    const address = this.server?.address();
    return address && typeof address === "object" ? address : null;
  }

  /**
   * Starts listening. Pass port 0 for a random free port.
   *
   * @param port - TCP port.
   * @param host - Optional host to bind (default: all interfaces).
   */
  async start(port: number, host?: string) {
    const server = createServer((req, res) => {
      this.handle(req, res).catch((error) => {
        console.error("[channels-linear] webhook server error:", error);
        if (!res.headersSent) res.statusCode = 500;
        res.end();
      });
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
    if (url.pathname === this.path) {
      const response = await this.handler(await toRequest(req, url));
      await writeResponse(response, res);
      return;
    }
    const isHealthCheck =
      req.method === "GET" && url.pathname === "/" && this.path !== "/";
    if (isHealthCheck) {
      res.statusCode = 200;
      res.setHeader("content-type", "text/plain");
      res.end("ok");
      return;
    }
    res.statusCode = 404;
    res.end();
  }
}
