import { createServer, type Server } from "node:http";
import { UnauthorizedError, type InboundVerifier } from "./auth.js";

export type ChatRequestHandler = (req: {
  headers: Record<string, string | string[] | undefined>;
  body: unknown;
}) => Promise<{ status: number; body?: unknown }>;

export function createRequestHandler(args: {
  verifier: InboundVerifier;
  onEvent: (event: unknown) => Promise<unknown>;
}): ChatRequestHandler {
  return async (req) => {
    const auth = req.headers["authorization"];
    const header = Array.isArray(auth) ? auth[0] : auth;
    try {
      await args.verifier.verify(header);
    } catch (e) {
      if (e instanceof UnauthorizedError) return { status: 401 };
      throw e;
    }
    const result = await args.onEvent(req.body);
    return { status: 200, body: result ?? {} };
  };
}

// Google Chat event payloads are small; 1 MiB is a generous upper bound. Capping
// the body size prevents an unauthenticated caller from exhausting memory by
// streaming an arbitrarily large request before any auth/JSON parsing happens.
const DEFAULT_MAX_BODY_BYTES = 1_048_576;

export function startServer(args: {
  port: number;
  handler: ChatRequestHandler;
  maxBodyBytes?: number;
}): { close(): Promise<void> } {
  const maxBodyBytes = args.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES;
  const server: Server = createServer((req, res) => {
    if (req.method !== "POST") {
      res.writeHead(405).end();
      return;
    }
    const chunks: Buffer[] = [];
    let received = 0;
    let aborted = false;
    req.on("data", (c) => {
      if (aborted) return;
      const chunk = c as Buffer;
      received += chunk.length;
      if (received > maxBodyBytes) {
        aborted = true;
        res.writeHead(413).end();
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", async () => {
      if (aborted) return;
      let body: unknown = {};
      try {
        body = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
      } catch {
        res.writeHead(400).end();
        return;
      }
      try {
        const out = await args.handler({ headers: req.headers, body });
        res.writeHead(out.status, { "Content-Type": "application/json" });
        res.end(JSON.stringify(out.body ?? {}));
      } catch (e) {
        console.error("[bot-google-chat] request handler failed:", e);
        res.writeHead(500).end();
      }
    });
  });
  server.listen(args.port);
  return {
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((e) => (e ? reject(e) : resolve())),
      ),
  };
}
