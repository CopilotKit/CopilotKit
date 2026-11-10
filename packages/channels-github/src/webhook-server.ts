import { createServer } from "node:http";
import type { IncomingMessage, Server, ServerResponse } from "node:http";

/** Options for {@link GitHubWebhookServer}. */
export interface GitHubWebhookServerOptions {
  /** The fetch-style handler from `createWebhookHandler`. */
  handler: (request: Request) => Promise<Response>;
  /** Path that receives webhook deliveries (default `"/webhook"`). */
  path?: string;
}

const BODYLESS_METHODS = new Set(["GET", "HEAD"]);

async function readBody(req: IncomingMessage) {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

async function toRequest(req: IncomingMessage, url: URL) {
  const method = req.method ?? "GET";
  const headers = new Headers();
  const entries = Object.entries(req.headers);
  for (const [key, value] of entries) {
    if (value === undefined) continue;
    const values = Array.isArray(value) ? value : [value];
    for (const item of values) headers.append(key, item);
  }
  const body = BODYLESS_METHODS.has(method) ? undefined : await readBody(req);
  return new Request(url, { method, headers, body });
}

async function writeResponse(response: Response, res: ServerResponse) {
  res.statusCode = response.status;
  response.headers.forEach((value, key) => res.setHeader(key, value));
  res.end(Buffer.from(await response.arrayBuffer()));
}

/**
 * A small `node:http` server around a GitHub webhook handler.
 *
 * Routes `POST <path>` to the handler, answers `GET /` with `200 ok` as a
 * health check (only when `path` is not `"/"`), and answers `404` for
 * everything else.
 *
 * @example
 * ```ts
 * const server = new GitHubWebhookServer({ handler: createWebhookHandler({ ... }) });
 * await server.start(3000);
 * ```
 */
export class GitHubWebhookServer {
  private readonly handler: (request: Request) => Promise<Response>;
  private readonly path: string;
  private server: Server | undefined;

  constructor(options: GitHubWebhookServerOptions) {
    this.handler = options.handler;
    this.path = options.path ?? "/webhook";
  }

  /** The bound address, or `null` when the server is not listening. */
  address() {
    const address = this.server?.address();
    return address && typeof address === "object" ? address : null;
  }

  /** Start listening. Pass port `0` to pick a free port; read it from `address()`. */
  async start(port: number, host?: string) {
    if (this.server) throw new Error("GitHubWebhookServer is already started");
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

  /** Stop listening. Does nothing when the server is not started. */
  async stop() {
    const server = this.server;
    if (!server) return;
    this.server = undefined;
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }

  private async handle(req: IncomingMessage, res: ServerResponse) {
    try {
      const url = new URL(req.url ?? "/", "http://localhost");
      const isHealthCheck =
        req.method === "GET" && url.pathname === "/" && this.path !== "/";
      if (isHealthCheck) {
        res.writeHead(200, { "content-type": "text/plain" }).end("ok");
        return;
      }
      if (url.pathname !== this.path) {
        res.writeHead(404).end();
        return;
      }
      const response = await this.handler(await toRequest(req, url));
      await writeResponse(response, res);
    } catch (error) {
      console.error("[channels-github] webhook server error:", error);
      if (!res.headersSent) res.statusCode = 500;
      res.end();
    }
  }
}
