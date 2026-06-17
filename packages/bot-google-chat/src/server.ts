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

export function startServer(args: { port: number; handler: ChatRequestHandler }): { close(): Promise<void> } {
  const server: Server = createServer((req, res) => {
    if (req.method !== "POST") { res.writeHead(405).end(); return; }
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c as Buffer));
    req.on("end", async () => {
      let body: unknown = {};
      try { body = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"); }
      catch { res.writeHead(400).end(); return; }
      try {
        const out = await args.handler({ headers: req.headers, body });
        res.writeHead(out.status, { "Content-Type": "application/json" });
        res.end(JSON.stringify(out.body ?? {}));
      } catch {
        res.writeHead(500).end();
      }
    });
  });
  server.listen(args.port);
  return {
    close: () => new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve()))),
  };
}
