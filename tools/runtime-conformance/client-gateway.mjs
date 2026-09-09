import { WebSocketServer } from "ws";

const terminals = new Set(["RUN_FINISHED", "RUN_ERROR"]);

/** Send a Phoenix server push with this channel's own join reference. */
function push(socket, channel, event, payload) {
  if (socket.readyState === 1)
    socket.send(
      JSON.stringify([channel.joinRef, null, channel.topic, event, payload]),
    );
}

/** Cursor is the durable runner event ID, never a fabricated timestamp. */
function control(channel) {
  return {
    thread_id: channel.threadId,
    organization_id: "fixture-org",
    latestEventId: channel.cursor,
  };
}

/**
 * Minimal real Phoenix client transport, based on Intelligence's
 * client/socket.ex and client/thread_channel.ex. It implements the supported
 * legacy event-journal replay path, not projection restore, Redis, or licensing.
 * Browser tokens authenticate one thread; runner API keys never authenticate it.
 */
export function createClientGateway({ events, locks, stopRun }) {
  const tokens = new Map();
  const sessions = new Map();
  const frames = [];
  const server = new WebSocketServer({ noServer: true, maxPayload: 2_000_000 });

  /** Scope a fixture-minted one-use credential without changing REST fixtures. */
  function registerToken(token, threadId, userId) {
    if (!token || !threadId || !userId)
      throw new Error("Invalid client token scope");
    tokens.set(token, { threadId, userId });
    return token;
  }

  /** Apply the actual client-channel stop filter and record replay coverage. */
  function deliver(socket, channel, event) {
    const eventId = event.metadata.cpki_event_id;
    if (channel.seen.has(eventId)) return;
    channel.seen.add(eventId);
    if (channel.stoppedRun === event.runId && !terminals.has(event.type))
      return;
    channel.cursor = eventId;
    push(socket, channel, "ag_ui_event", event);
  }

  /** Run mode must never deliver content before the durable RUN_STARTED baseline. */
  function replay(socket, channel) {
    let history = events.filter(
      (event) =>
        event.threadId === channel.threadId &&
        (channel.mode !== "run" || event.runId === channel.runId),
    );
    if (channel.mode === "run" && history[0]?.type !== "RUN_STARTED") return;
    if (channel.after) {
      const cursor = history.findIndex(
        (event) => event.metadata.cpki_event_id === channel.after,
      );
      history = cursor === -1 ? [] : history.slice(cursor + 1);
    }
    for (const event of history) deliver(socket, channel, event);
    channel.replaying = false;
    clearTimeout(channel.baselineTimer);
    push(socket, channel, "replay_complete", control(channel));
    if (channel.mode === "connect" && !locks.has(channel.threadId))
      push(socket, channel, "stream_idle", control(channel));
  }

  server.on("connection", (socket, scope) => {
    const channels = new Map();
    sessions.set(socket, channels);
    socket.on("close", () => {
      for (const channel of channels.values())
        clearTimeout(channel.baselineTimer);
      sessions.delete(socket);
    });
    socket.on("message", (raw) => {
      try {
        const frame = JSON.parse(String(raw));
        if (!Array.isArray(frame) || frame.length !== 5)
          throw new Error("Invalid frame");
        const [joinRef, ref, topic, event, payload] = frame;
        frames.push({ topic, event, payload: structuredClone(payload) });
        const reply = (status, response = {}) => {
          if (socket.readyState === 1)
            socket.send(
              JSON.stringify([
                joinRef,
                ref,
                topic,
                "phx_reply",
                { status, response },
              ]),
            );
        };
        if (topic === "phoenix" && event === "heartbeat") {
          reply("ok");
          return;
        }
        if (event === "phx_join") {
          if (topic !== `thread:${scope.threadId}`) {
            reply("error", { reason: "token_thread_mismatch" });
            return;
          }
          const mode = payload?.stream_mode ?? "connect";
          if (!["run", "connect"].includes(mode)) {
            reply("error", { reason: "unsupported_stream_mode" });
            return;
          }
          const channel = {
            joinRef,
            topic,
            threadId: scope.threadId,
            mode,
            runId: payload?.run_id,
            after: payload?.last_seen_event_id ?? null,
            cursor: payload?.last_seen_event_id ?? null,
            seen: new Set(),
            replaying: true,
            stoppedRun: null,
            baselineTimer: null,
          };
          clearTimeout(channels.get(topic)?.baselineTimer);
          channels.set(topic, channel);
          reply("ok");
          push(socket, channel, "connected", {
            thread_id: scope.threadId,
            user_id: scope.userId,
            organization_id: "fixture-org",
          });
          replay(socket, channel);
          if (channel.replaying) {
            channel.baselineTimer = setTimeout(() => {
              push(socket, channel, "replay_failed", {
                reason: "missing_run_baseline",
              });
              socket.close(1011, "Missing run baseline");
            }, 60_000);
            channel.baselineTimer.unref();
          }
          return;
        }
        const channel = channels.get(topic);
        if (!channel || channel.joinRef !== joinRef) {
          reply("error", { reason: "unmatched_topic" });
          return;
        }
        if (event === "phx_leave") {
          clearTimeout(channel.baselineTimer);
          channels.delete(topic);
          reply("ok");
          return;
        }
        if (event === "stop_run" && typeof payload?.run_id === "string") {
          // The real RunStopper broadcasts both thread and run scope. Our
          // callback reaches a run-indexed fixture, so enforce both here.
          if (locks.get(scope.threadId)?.runId !== payload.run_id) {
            reply("error", { reason: "run_thread_mismatch" });
            return;
          }
          channel.stoppedRun = payload.run_id;
          stopRun(scope.threadId, payload.run_id);
          reply("ok");
          return;
        }
        reply("error", { reason: "unsupported_event" });
      } catch {
        socket.close(1008, "Invalid Phoenix frame");
      }
    });
  });

  return {
    frames,
    registerToken,
    /** Return false only when this upgrade belongs to a different transport. */
    handleUpgrade(request, socket, head) {
      const url = new URL(request.url, "http://fixture.invalid");
      if (url.pathname !== "/client/websocket") return false;
      const token = url.searchParams.get("join_token");
      const scope = tokens.get(token);
      if (!scope) {
        socket.end("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n");
        return true;
      }
      tokens.delete(token);
      server.handleUpgrade(request, socket, head, (ws) =>
        server.emit("connection", ws, scope),
      );
      return true;
    },
    /** Publish only after platform persistence; journal replay covers late subscribers. */
    onPersist(event) {
      for (const [socket, channels] of sessions) {
        for (const channel of channels.values()) {
          if (
            channel.threadId !== event.threadId ||
            (channel.mode === "run" && channel.runId !== event.runId)
          )
            continue;
          if (channel.replaying) {
            replay(socket, channel);
            continue;
          }
          deliver(socket, channel, event);
          if (
            channel.mode === "connect" &&
            terminals.has(event.type) &&
            (!locks.has(event.threadId) ||
              locks.get(event.threadId)?.runId === event.runId)
          )
            push(socket, channel, "stream_idle", control(channel));
        }
      }
    },
    /** Stop sockets and timers owned by this fixture, never by the runtime process. */
    async close() {
      tokens.clear();
      for (const [socket, channels] of sessions) {
        for (const channel of channels.values())
          clearTimeout(channel.baselineTimer);
        socket.terminate();
      }
      await new Promise((resolve) => server.close(resolve));
    },
  };
}
