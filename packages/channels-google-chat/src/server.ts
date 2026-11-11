import { createServer } from "node:http";
import type { IncomingMessage, Server, ServerResponse } from "node:http";
import { UnauthorizedError } from "./auth.js";
import type { InboundVerifier } from "./auth.js";

/** A framework-neutral webhook request: headers plus the parsed JSON body. */
export interface ChatWebhookRequest {
  headers: Record<string, string | string[] | undefined>;
  body: unknown;
}

export interface ChatWebhookResponse {
  status: number;
  body?: unknown;
}

export type ChatRequestHandler = (
  req: ChatWebhookRequest,
) => Promise<ChatWebhookResponse>;

/**
 * Verify the request, acknowledge it at once, and process the event in the
 * background. Google Chat waits at most 30 seconds for the HTTP response, and
 * an agent run can take longer, so replies go out through the REST API
 * instead of the response body.
 */
export function createRequestHandler(args: {
  verifier: InboundVerifier;
  onEvent: (event: unknown) => Promise<void>;
}): ChatRequestHandler {
  return async (req) => {
    const auth = req.headers["authorization"];
    const header = Array.isArray(auth) ? auth[0] : auth;
    try {
      await args.verifier.verify(header);
    } catch (e) {
      if (e instanceof UnauthorizedError) {
        console.warn("[channels-google-chat] rejected webhook:", e.message);
        return { status: 401 };
      }
      throw e;
    }
    void args.onEvent(req.body).catch((err) => {
      console.error("[channels-google-chat] event handling failed:", err);
    });
    return { status: 200, body: {} };
  };
}

// Google Chat event payloads are small; 1 MiB is a generous upper bound. The
// cap stops an unauthenticated caller from exhausting memory before auth runs.
const DEFAULT_MAX_BODY_BYTES = 1_048_576;

/** A Node `http` listener that serves `handler` on `path` (POST only). */
export function createNodeListener(args: {
  handler: ChatRequestHandler;
  path?: string;
  maxBodyBytes?: number;
}): (req: IncomingMessage, res: ServerResponse) => void {
  const maxBodyBytes = args.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES;
  const path = args.path ?? "/";
  return (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (url.pathname !== path) {
      res.writeHead(404).end();
      return;
    }
    if (req.method !== "POST") {
      res.writeHead(405).end();
      return;
    }
    const chunks: Buffer[] = [];
    let received = 0;
    let aborted = false;
    req.on("data", (c: Buffer) => {
      if (aborted) return;
      received += c.length;
      if (received > maxBodyBytes) {
        aborted = true;
        res.writeHead(413).end();
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", async () => {
      if (aborted) return;
      let body: unknown;
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
        console.error("[channels-google-chat] request handler failed:", e);
        res.writeHead(500).end();
      }
    });
  };
}

/** Start a self-hosted HTTP server for the webhook. */
export async function startServer(args: {
  port: number;
  path?: string;
  handler: ChatRequestHandler;
}): Promise<{ server: Server; close(): Promise<void> }> {
  const server = createServer(
    createNodeListener({ handler: args.handler, path: args.path }),
  );
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(args.port, () => {
      server.off("error", reject);
      resolve();
    });
  });
  return {
    server,
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((e) => (e ? reject(e) : resolve())),
      ),
  };
}
