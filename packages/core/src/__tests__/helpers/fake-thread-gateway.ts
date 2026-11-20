import { createServer } from "node:http";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import type { BaseEvent } from "@ag-ui/client";
import { WebSocketServer } from "ws";
import type { WebSocket } from "ws";

/**
 * A fake Intelligence on 127.0.0.1 for the browser side of a run, so a test
 * can drive the real `phoenix` client against it.
 *
 * - The runtime's `POST /agent/:agentId/run` hands out join credentials for
 *   the run, as the runtime does in Intelligence mode.
 * - realtime-gateway's thread channel answers the way the real one does
 *   (Phoenix 1.8 `Phoenix.Socket` and `Phoenix.Channel.Server`, plus
 *   `RealtimeGateway.Client.ThreadChannel`):
 *   - `phx_join` on `thread:<id>` replies ok.
 *   - `stop_run` replies ok straight away, as `handle_authorized_in("stop_run", ...)`
 *     returns `{:reply, :ok, ...}`.
 *   - `phx_leave` on a joined topic replies ok, then pushes `phx_close`: the
 *     channel stops with `{:shutdown, :left}` and the socket reports the close.
 *   - A push to a topic this connection has not joined gets an error reply,
 *     `unmatched topic`, as `Phoenix.Socket` sends for a dropped channel.
 *   - Heartbeats on `phoenix` reply ok.
 *
 * The test sends a run's AG-UI events to its channel with `emit`.
 */

type Frame = [string | null, string | null, string, string, unknown];

interface ChannelJoin {
  runId: string;
  topic: string;
  joinRef: string;
  connection: WebSocket;
  state: "joined" | "left";
}

export async function startFakeThreadGateway() {
  /** What the gateway received, in order, as `<runId> <event>`. */
  const timeline: string[] = [];
  /** The `run_id` of every `stop_run` the gateway accepted, in order. */
  const stops: string[] = [];
  const joins: ChannelJoin[] = [];
  let port = 0;

  const server: Server = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    const raw = Buffer.concat(chunks).toString("utf8");
    const body = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    const send = (status: number, payload: unknown) => {
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(JSON.stringify(payload));
    };

    if (
      req.method === "POST" &&
      /^\/api\/copilotkit\/agent\/[^/]+\/run$/.test(url.pathname)
    ) {
      const threadId = body.threadId as string;
      const runId = body.runId as string;
      timeline.push(`${runId} run requested`);
      return send(200, {
        threadId,
        runId,
        joinToken: `join-token-${runId}`,
        realtime: {
          clientUrl: `ws://127.0.0.1:${port}/client`,
          topic: `thread:${threadId}`,
        },
      });
    }
    return send(404, { error: "not found" });
  });

  const sockets = new WebSocketServer({ server });
  sockets.on("connection", (connection: WebSocket) => {
    const reply = (
      frame: Frame,
      status: "ok" | "error",
      response: Record<string, unknown> = {},
      joinRef: string | null = frame[0],
    ) => {
      const [, ref, topic] = frame;
      connection.send(
        JSON.stringify([
          joinRef,
          ref,
          topic,
          "phx_reply",
          { status, response },
        ]),
      );
    };

    connection.on("message", (data) => {
      const frame = JSON.parse(data.toString()) as Frame;
      const [joinRef, , topic, event, payload] = frame;

      if (topic === "phoenix" && event === "heartbeat") {
        return reply(frame, "ok");
      }

      if (event === "phx_join" && topic.startsWith("thread:")) {
        const runId = (payload as { run_id?: string }).run_id ?? "connect";
        joins.push({
          runId,
          topic,
          joinRef: joinRef as string,
          connection,
          state: "joined",
        });
        timeline.push(`${runId} phx_join`);
        return reply(frame, "ok");
      }

      const join = joins.find(
        (candidate) =>
          candidate.connection === connection &&
          candidate.topic === topic &&
          candidate.joinRef === joinRef &&
          candidate.state === "joined",
      );
      if (!join) {
        timeline.push(`unmatched ${event}`);
        return reply(frame, "error", { reason: "unmatched topic" }, null);
      }

      timeline.push(`${join.runId} ${event}`);
      if (event === "phx_leave") {
        join.state = "left";
        reply(frame, "ok");
        connection.send(
          JSON.stringify([join.joinRef, join.joinRef, topic, "phx_close", {}]),
        );
        return;
      }
      if (event === "stop_run") {
        stops.push((payload as { run_id: string }).run_id);
      }
      // stop_run, and anything else the client pushes, is acknowledged.
      reply(frame, "ok");
    });
  });

  await new Promise<void>((resolve) =>
    server.listen(0, "127.0.0.1", () => resolve()),
  );
  port = (server.address() as AddressInfo).port;

  const joinFor = (runId: string) => joins.find((join) => join.runId === runId);

  return {
    /** The runtime URL a `ProxiedCopilotRuntimeAgent` is configured with. */
    runtimeUrl: `http://127.0.0.1:${port}/api/copilotkit`,
    /** The websocket URL the runtime's `/info` reports for Intelligence. */
    wsUrl: `ws://127.0.0.1:${port}/client`,
    timeline,
    stops,
    /** Whether the run's channel is joined, as the gateway sees it. */
    isJoined(runId: string): boolean {
      return joinFor(runId)?.state === "joined";
    },
    /** Pushes one AG-UI event to the run's channel. */
    emit(runId: string, event: BaseEvent) {
      const join = joinFor(runId);
      if (!join || join.state !== "joined") {
        throw new Error(`run ${runId} has no joined channel`);
      }
      join.connection.send(
        JSON.stringify([join.joinRef, null, join.topic, "ag_ui_event", event]),
      );
    },
    async close() {
      sockets.clients.forEach((connection) => connection.terminate());
      await new Promise<void>((resolve) => sockets.close(() => resolve()));
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
