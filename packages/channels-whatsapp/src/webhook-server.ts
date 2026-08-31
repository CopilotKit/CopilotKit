import { createServer } from "node:http";
import type { Server, IncomingMessage, ServerResponse } from "node:http";
import { createHmac, timingSafeEqual } from "node:crypto";
import type { AddressInfo } from "node:net";
import type { WebhookBody } from "./types.js";

export interface WebhookServerArgs {
  path: string;
  verifyToken: string;
  appSecret: string;
  /** Called (async, after the 200 ack) with the parsed webhook body. */
  onEvent: (body: WebhookBody) => Promise<void>;
}

/** Owns the inbound webhook HTTP server: GET verify + signed POST intake. */
export class WebhookServer {
  private readonly args: WebhookServerArgs;
  private server: Server | undefined;

  constructor(args: WebhookServerArgs) {
    this.args = args;
  }

  address(): AddressInfo | null {
    const a = this.server?.address();
    return a && typeof a === "object" ? (a as AddressInfo) : null;
  }

  async start(port: number): Promise<void> {
    this.server = createServer((req, res) => this.handle(req, res));
    await new Promise<void>((resolve) => this.server!.listen(port, resolve));
  }

  async stop(): Promise<void> {
    if (!this.server) return;
    await new Promise<void>((resolve, reject) =>
      this.server!.close((err) => (err ? reject(err) : resolve())),
    );
    this.server = undefined;
  }

  private handle(req: IncomingMessage, res: ServerResponse): void {
    const url = new URL(req.url ?? "/", "http://localhost");
    // Health check — gives the Railway public domain a 200 to hit. The webhook
    // itself lives at `this.args.path`; everything else 404s as before. Guard
    // with `path !== "/"` so that if an operator configures the webhook AT the
    // root, the Meta verify handshake (GET /?hub...) is not shadowed by health.
    if (
      req.method === "GET" &&
      url.pathname === "/" &&
      this.args.path !== "/"
    ) {
      res.statusCode = 200;
      res.setHeader("content-type", "text/plain");
      res.end("ok");
      return;
    }
    if (url.pathname !== this.args.path) {
      res.statusCode = 404;
      res.end();
      return;
    }
    if (req.method === "GET") return this.handleVerify(url, res);
    if (req.method === "POST") return this.handlePost(req, res);
    res.statusCode = 405;
    res.end();
  }

  private handleVerify(url: URL, res: ServerResponse): void {
    const mode = url.searchParams.get("hub.mode");
    const token = url.searchParams.get("hub.verify_token");
    const challenge = url.searchParams.get("hub.challenge") ?? "";
    if (mode === "subscribe" && token === this.args.verifyToken) {
      res.statusCode = 200;
      res.end(challenge);
    } else {
      res.statusCode = 403;
      res.end();
    }
  }

  private handlePost(req: IncomingMessage, res: ServerResponse): void {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c as Buffer));
    req.on("end", () => {
      const rawBuf = Buffer.concat(chunks);
      const raw = rawBuf.toString("utf8");
      const sig = req.headers["x-hub-signature-256"];
      if (
        !this.verifySignature(rawBuf, typeof sig === "string" ? sig : undefined)
      ) {
        res.statusCode = 401;
        res.end();
        return;
      }
      // Ack immediately; Meta retries non-200 and can disable a flapping webhook.
      res.statusCode = 200;
      res.end();
      let body: WebhookBody;
      try {
        body = JSON.parse(raw) as WebhookBody;
      } catch {
        return;
      }
      void this.args.onEvent(body).catch((err) => {
        console.error("[whatsapp] onEvent failed:", err);
      });
    });
  }

  private verifySignature(raw: Buffer, signature: string | undefined): boolean {
    if (!signature || !signature.startsWith("sha256=")) return false;
    const expected =
      "sha256=" +
      createHmac("sha256", this.args.appSecret).update(raw).digest("hex");
    const a = Buffer.from(signature);
    const b = Buffer.from(expected);
    return a.length === b.length && timingSafeEqual(a, b);
  }
}
