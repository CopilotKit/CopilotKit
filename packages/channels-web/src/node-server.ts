import { createServer } from "node:http";
import type { IncomingMessage, Server, ServerResponse } from "node:http";

/** Largest request body the `port` server reads (conversation history included). */
export const MAX_BODY_BYTES = 10 * 1024 * 1024;

export interface NodeServerOptions {
  port: number;
  host?: string;
  path: string;
  handler: (request: Request) => Promise<Response>;
}

async function readBody(
  req: IncomingMessage,
): Promise<Uint8Array | "too-large"> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = chunk as Buffer;
    size += buffer.length;
    if (size > MAX_BODY_BYTES) return "too-large";
    chunks.push(buffer);
  }
  return new Uint8Array(Buffer.concat(chunks));
}

async function serve(
  opts: NodeServerOptions,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const url = new URL(req.url ?? "/", "http://localhost");
  if (url.pathname !== opts.path) {
    res.writeHead(404).end();
    return;
  }
  const abort = new AbortController();
  res.on("close", () => {
    if (!res.writableFinished) abort.abort();
  });
  const headers = new Headers();
  for (const [name, value] of Object.entries(req.headers)) {
    if (Array.isArray(value)) value.forEach((v) => headers.append(name, v));
    else if (value !== undefined) headers.set(name, value);
  }
  let body: Uint8Array | undefined;
  if (req.method !== "GET" && req.method !== "HEAD") {
    const read = await readBody(req);
    if (read === "too-large") {
      res.writeHead(413).end();
      return;
    }
    body = read;
  }
  const request = new Request(
    new URL(
      url.pathname + url.search,
      `http://${req.headers.host ?? "localhost"}`,
    ),
    {
      method: req.method,
      headers,
      body: body as BodyInit | undefined,
      signal: abort.signal,
    },
  );
  const response = await opts.handler(request);
  res.writeHead(
    response.status,
    Object.fromEntries(response.headers.entries()),
  );
  if (!response.body) {
    res.end();
    return;
  }
  const reader = response.body.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!res.write(value)) {
        await new Promise<void>((resolve) => res.once("drain", resolve));
      }
    }
  } finally {
    res.end();
  }
}

/** A small `node:http` server that hands each request to a fetch-style handler. */
export class NodeServer {
  private server: Server | undefined;

  constructor(private readonly opts: NodeServerOptions) {}

  async start(): Promise<void> {
    const server = createServer((req, res) => {
      serve(this.opts, req, res).catch((err) => {
        console.error("[channels-web] request failed:", err);
        if (!res.headersSent) res.writeHead(500);
        res.end();
      });
    });
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(this.opts.port, this.opts.host, () => {
        server.off("error", reject);
        resolve();
      });
    });
    this.server = server;
  }

  /** The bound port (useful with `port: 0`). */
  get port(): number | undefined {
    const address = this.server?.address();
    return typeof address === "object" && address ? address.port : undefined;
  }

  async stop(): Promise<void> {
    const server = this.server;
    this.server = undefined;
    if (!server) return;
    server.closeAllConnections?.();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}
