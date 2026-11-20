import { createServer } from "node:http";
import type { IncomingMessage, Server } from "node:http";
import type { AddressInfo } from "node:net";
import { EventType } from "@ag-ui/client";
import type { BaseEvent } from "@ag-ui/client";
import { WebSocketServer } from "ws";
import type { WebSocket } from "ws";

/**
 * A fake Intelligence on 127.0.0.1: the REST routes a run touches, the runner
 * socket and the client socket, all on one port. It logs, in arrival order,
 * every runner event, every `POST /connect` and every client `stop_run`, so a
 * test can tell whether a stop was recorded before the terminal event.
 */

type Frame = [string | null, string | null, string, string, unknown];

export type ConnectMode = "ok" | "http-error";
export type StopMode = "ok" | "error" | "silent";
export type RenewMode = "ok" | "lost";

export async function startFakeIntelligence(options: {
  connect: ConnectMode;
  stop: StopMode;
  renew?: RenewMode;
  /** The agent the fake's threads belong to. */
  agentId?: string;
}) {
  const timeline: string[] = [];
  const connectBodies: unknown[] = [];
  const runnerSockets: WebSocket[] = [];
  const mintedTokens = new Set<string>();

  const server: Server = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    const raw = Buffer.concat(chunks).toString("utf8");
    const body = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    const method = req.method ?? "GET";
    const send = (status: number, payload?: unknown) => {
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(payload === undefined ? "" : JSON.stringify(payload));
    };
    const match = url.pathname.match(/^\/api\/threads\/([^/]+)(\/[^/]+)?$/);
    if (!match) return send(404, { error: "not found" });
    const [, id, rest] = match;
    if (method === "GET" && rest === undefined) {
      return send(200, {
        thread: { id, name: "Existing", agentId: options.agentId ?? "test" },
      });
    }
    if (method === "GET" && rest === "/messages") {
      return send(200, { messages: [] });
    }
    if (rest === "/lock" && method === "POST") {
      return send(200, {
        threadId: id,
        runId: body.runId,
        joinToken: "browser-join-token",
        ttlSeconds: 120,
      });
    }
    if (rest === "/lock" && method === "PATCH") {
      if (options.renew === "lost") {
        timeline.push("lock lost");
        return send(409, { error: "THREAD_LOCK_LOST", retryable: false });
      }
      return send(200, { ttlSeconds: 120, status: "renewed" });
    }
    if (rest === "/lock" && method === "DELETE") return send(204);
    if (rest === "/connect" && method === "POST") {
      timeline.push("POST /connect");
      connectBodies.push(body);
      if (options.connect === "http-error") {
        return send(500, { error: "internal" });
      }
      const joinToken = `stop-token-${mintedTokens.size + 1}`;
      mintedTokens.add(joinToken);
      return send(200, { threadId: id, joinToken });
    }
    return send(404, { error: "not found" });
  });

  const sockets = new WebSocketServer({ server });
  sockets.on("connection", (socket: WebSocket, req: IncomingMessage) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    const isClient = url.pathname.startsWith("/client");
    if (isClient) {
      // The client socket admits only a token Intelligence minted, once.
      const token = url.searchParams.get("join_token") ?? "";
      if (!mintedTokens.delete(token)) {
        socket.close(1008);
        return;
      }
    } else {
      runnerSockets.push(socket);
    }
    socket.on("message", (data) => {
      const frame = JSON.parse(data.toString()) as Frame;
      const [joinRef, ref, topic, event, payload] = frame;
      const reply = (status: string) =>
        socket.send(
          JSON.stringify([
            joinRef,
            ref,
            topic,
            "phx_reply",
            { status, response: {} },
          ]),
        );
      if (event === "event" || event === "events") {
        const received = (
          event === "events"
            ? (payload as { events: BaseEvent[] }).events
            : [payload]
        ) as BaseEvent[];
        for (const item of received) timeline.push(`runner ${item.type}`);
        reply("ok");
        return;
      }
      if (isClient && event === "stop_run") {
        timeline.push(`stop_run ${(payload as { run_id: string }).run_id}`);
        if (options.stop === "ok") reply("ok");
        if (options.stop === "error") reply("error");
        return;
      }
      if (isClient && event === "phx_join") {
        timeline.push(`client join ${topic}`);
      }
      reply("ok");
    });
  });

  await new Promise<void>((resolve) =>
    server.listen(0, "127.0.0.1", () => resolve()),
  );
  const { port } = server.address() as AddressInfo;

  return {
    apiUrl: `http://127.0.0.1:${port}`,
    wsUrl: `ws://127.0.0.1:${port}`,
    timeline,
    connectBodies,
    /** Sends the stop Intelligence relays after its own stop to the runner. */
    relayGatewayStop(runId: string) {
      for (const socket of runnerSockets) {
        socket.send(
          JSON.stringify([
            null,
            null,
            `ingestion:${runId}`,
            "ag-ui",
            { type: EventType.CUSTOM, name: "stop" },
          ]),
        );
      }
    },
    async close() {
      sockets.clients.forEach((socket) => socket.terminate());
      await new Promise<void>((resolve) => sockets.close(() => resolve()));
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
