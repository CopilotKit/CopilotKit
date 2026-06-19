// src/main/bridge/server.ts
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { randomUUID } from "node:crypto";
import { WebSocketServer } from "ws";
import type { BridgeMethod } from "./protocol";
import { parseInbound } from "./protocol";

/** The narrow socket surface the server uses (real `ws` socket satisfies it). */
export interface BridgeSocket {
  send(data: string): void;
  close(code?: number, reason?: string): void;
  on(event: "message", cb: (data: unknown) => void): void;
  on(event: "close", cb: () => void): void;
}
/** The narrow server surface (real `ws` WebSocketServer satisfies it). */
export interface BridgeWss {
  on(
    event: "connection",
    cb: (socket: BridgeSocket, req: { url?: string }) => void,
  ): void;
  close(cb?: () => void): void;
}

export type BridgeStatus = { connected: boolean };

interface Pending {
  resolve: (data: unknown) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

export interface BridgeServerOptions {
  /** One-time pairing token an incoming socket must present as ?token=. */
  token: string;
  /** Per-request reply timeout (ms). Default 10_000. */
  timeoutMs?: number;
  /** Factory for the WS server — injectable so units use a fake (no socket). */
  createWss?: () => Promise<{ wss: BridgeWss; port: number }>;
}

export class BridgeServer {
  private readonly token: string;
  private readonly timeoutMs: number;
  private readonly createWss: () => Promise<{ wss: BridgeWss; port: number }>;
  private wss: BridgeWss | null = null;
  private socket: BridgeSocket | null = null;
  private port = 0;
  private readonly pending = new Map<string, Pending>();

  constructor(opts: BridgeServerOptions) {
    this.token = opts.token;
    this.timeoutMs = opts.timeoutMs ?? 10_000;
    this.createWss = opts.createWss ?? defaultCreateWss;
  }

  async start(): Promise<{ port: number }> {
    const { wss, port } = await this.createWss();
    this.wss = wss;
    this.port = port;
    wss.on("connection", (socket, req) => this.onConnection(socket, req));
    return { port };
  }

  private onConnection(socket: BridgeSocket, req: { url?: string }): void {
    const presented = new URLSearchParams(
      (req.url ?? "").split("?")[1] ?? "",
    ).get("token");
    if (presented !== this.token) {
      socket.close(1008, "unauthorized");
      return;
    }
    // Most-recent valid socket wins; a new pairing replaces the old.
    this.socket = socket;
    socket.on("message", (data) => this.onMessage(socket, String(data)));
    socket.on("close", () => {
      if (this.socket === socket) this.socket = null;
    });
  }

  private onMessage(socket: BridgeSocket, raw: string): void {
    let msg;
    try {
      msg = parseInbound(raw);
    } catch {
      return; // ignore malformed frames
    }
    if (msg.type === "ping") {
      socket.send(JSON.stringify({ type: "pong" }));
      return;
    }
    const entry = this.pending.get(msg.id);
    if (!entry) return;
    this.pending.delete(msg.id);
    clearTimeout(entry.timer);
    if (msg.type === "result") entry.resolve(msg.data);
    else entry.reject(new Error(msg.message));
  }

  /** Send a request to the paired extension; await the correlated reply. */
  request(
    method: BridgeMethod,
    params: Record<string, unknown>,
  ): Promise<unknown> {
    if (!this.socket) {
      return Promise.reject(new Error("no browser connected"));
    }
    const id = randomUUID();
    const socket = this.socket;
    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`bridge request '${method}' timed out`));
      }, this.timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      socket.send(JSON.stringify({ type: "request", id, method, params }));
    });
  }

  isConnected(): boolean {
    return this.socket !== null;
  }

  getStatus(): BridgeStatus {
    return { connected: this.isConnected() };
  }

  async close(): Promise<void> {
    for (const [, p] of this.pending) {
      clearTimeout(p.timer);
      p.reject(new Error("bridge closing"));
    }
    this.pending.clear();
    await new Promise<void>((res) => {
      if (!this.wss) return res();
      this.wss.close(() => res());
    });
    this.wss = null;
    this.socket = null;
  }
}

/** Real WS server over an ephemeral 127.0.0.1 port (same pattern as runtime/server.ts). */
async function defaultCreateWss(): Promise<{ wss: BridgeWss; port: number }> {
  const httpServer = createServer();
  const wss = new WebSocketServer({ server: httpServer });
  const port = await new Promise<number>((resolve) => {
    httpServer.listen(0, "127.0.0.1", () => {
      resolve((httpServer.address() as AddressInfo).port);
    });
  });
  // Close the http server alongside the wss.
  const realClose = wss.close.bind(wss);
  (wss as unknown as { close: (cb?: () => void) => void }).close = (cb) =>
    realClose(() => httpServer.close(() => cb?.()));
  return { wss: wss as unknown as BridgeWss, port };
}
