import { createServer } from "node:http";
import type { IncomingMessage, Server } from "node:http";
import type { AddressInfo } from "node:net";
import { EventType } from "@ag-ui/client";
import type { BaseEvent } from "@ag-ui/client";
import { WebSocketServer } from "ws";
import type { WebSocket } from "ws";

/**
 * A fake Intelligence on 127.0.0.1 that keeps a thread's lock the way the
 * real one does, so a test can see whether the runtime lets go of it too
 * early.
 *
 * - app-api's lock routes: acquiring is set-if-absent, renewing is
 *   compare-and-expire, and releasing (`DELETE`) is compare-and-delete by run
 *   ID, answering `{ threadId, runId, released }`.
 * - realtime-gateway's runner channel: the join checks the lock, and every
 *   batch is checked against the lock again when it is stored, as the
 *   gateway's accept script does. A batch is refused with
 *   `active_lock_mismatch`, not retryable, unless its run holds the lock, or
 *   no run holds it and the batch ends this run. Storing a run's terminal
 *   event while the run holds the lock records the run as ended and deletes
 *   the lock.
 *
 * - app-api's thread routes, when `threads` is set: a thread is unknown
 *   (404) until `POST /api/threads` creates it, and its messages are the
 *   ones it was given.
 * - a browser's Stop, by the route the runtime also records its own stops:
 *   `POST /api/threads/:id/connect` mints a single-use join token, and
 *   `stop_run` on the thread's client channel stores the stop and relays it
 *   to the run's runner.
 *
 * `storeDelayMs` is how long the gateway takes to store a batch after it
 * arrives: the network and Redis time between the runner sending a batch and
 * the lock check that decides it.
 */

type Frame = [string | null, string | null, string, string, unknown];

export interface FakeLockGatewayOptions {
  storeDelayMs?: number;
  /** Refuse the runner's join, as the gateway does for a missing thread. */
  refuseJoin?: boolean;
  /**
   * Refuse the batch with this 1-based number for good, as the gateway does
   * when a thread outgrows its share of the event store.
   */
  refuseBatch?: number;
  /**
   * The threads the platform holds, by ID, with their stored messages. When
   * set, any other thread is unknown until it is created. Unset, every thread
   * exists and has no messages.
   */
  threads?: Record<string, StoredMessage[]>;
  /**
   * Grant the lock but hold its response back until `answerLock()` is
   * called, as a platform does whose answer is lost on the way back.
   */
  holdLockResponse?: boolean;
  /** Never answer a lock release, as a platform that stopped answering. */
  holdRelease?: boolean;
  /** Answer 404 for a thread's stored state, as a platform that does not serve it. */
  servesNoState?: boolean;
}

/** A message as app-api stores and returns it. */
export interface StoredMessage {
  id: string;
  role: string;
  content?: unknown;
  toolCalls?: Array<{ id: string; name: string; args: string }>;
  toolCallId?: string;
}

/** One HTTP request the fake received, as a test reads it. */
export interface FakeRequest {
  method: string;
  path: string;
  body: Record<string, unknown>;
}

const RUNNER_EVENT_BATCH_CAPABILITY = "runner_event_batch_v1";

function isTerminal(event: BaseEvent): boolean {
  return (
    event.type === EventType.RUN_FINISHED || event.type === EventType.RUN_ERROR
  );
}

function eventId(event: BaseEvent): string {
  return (event as { metadata?: { cpki_event_id?: string } }).metadata
    ?.cpki_event_id as string;
}

export async function startFakeLockGateway(
  options: FakeLockGatewayOptions = {},
) {
  /** What happened, in order, as a test reads it. */
  const timeline: string[] = [];
  /** Every event the gateway stored, in order. */
  const stored: BaseEvent[] = [];
  /** threadId -> runId of the run that holds the thread's lock. */
  const locks = new Map<string, string>();
  /** `${threadId}:${runId}` -> terminal marker of a run that has ended. */
  const terminalMarkers = new Map<string, string>();
  const storedEventIds = new Set<string>();
  const runnerSockets = new Set<WebSocket>();
  /** threadId -> the state the thread's last STATE_SNAPSHOT stored. */
  const snapshots = new Map<string, unknown>();
  /** Threads that stored a STATE_DELTA, which this fake does not fold. */
  const deltas = new Set<string>();
  /** Lock responses held back by `holdLockResponse`. */
  const heldLockAnswers: Array<() => void> = [];
  let batchCount = 0;
  /** Batches received and not yet stored or refused. */
  let pendingBatches = 0;
  /** Every HTTP request, in arrival order. */
  const requests: FakeRequest[] = [];
  const threads = options.threads
    ? new Map(Object.entries(options.threads))
    : undefined;
  /** Join tokens minted for the client socket, each usable once. */
  const joinTokens = new Set<string>();

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
    requests.push({ method, path: url.pathname, body });
    const inspected = url.pathname.match(
      /^\/api\/_inspect\/threads\/([^/]+)\/state$/,
    );
    if (method === "GET" && inspected) {
      if (options.servesNoState) return send(404);
      // The stored state as app-api folds it: the last snapshot, and the
      // deltas after it, which this fake refuses rather than fold wrongly.
      const [, inspectedId] = inspected;
      if (deltas.has(inspectedId)) {
        return send(500, { error: "the fake does not fold STATE_DELTA" });
      }
      return send(
        200,
        snapshots.has(inspectedId)
          ? {
              kind: "snapshot",
              state: snapshots.get(inspectedId),
              skippedDeltas: 0,
            }
          : { kind: "no-snapshot" },
      );
    }
    if (method === "POST" && url.pathname === "/api/threads") {
      const id = body.threadId as string;
      if (!threads) return send(404, { error: "not found" });
      if (threads.has(id)) {
        return send(409, { error: { code: "THREAD_EXISTS" } });
      }
      threads.set(id, []);
      timeline.push("thread created");
      return send(201, {
        thread: { id, name: null, agentId: body.agentId },
      });
    }
    const match = url.pathname.match(/^\/api\/threads\/([^/]+)(\/[^/]+)?$/);
    if (!match) return send(404, { error: "not found" });
    const [, threadId, rest] = match;
    if (threads && !threads.has(threadId)) {
      return send(404, { error: { code: "THREAD_NOT_FOUND" } });
    }
    if (method === "GET" && rest === undefined) {
      return send(200, {
        thread: { id: threadId, name: "Existing", agentId: "test" },
      });
    }
    if (method === "GET" && rest === "/messages") {
      return send(200, { messages: threads?.get(threadId) ?? [] });
    }
    if (method === "POST" && rest === "/connect") {
      const joinToken = `join-token-${joinTokens.size + 1}`;
      joinTokens.add(joinToken);
      return send(200, { threadId, joinToken });
    }
    if (rest !== "/lock") return send(404, { error: "not found" });

    const runId = body.runId as string;
    const owner = locks.get(threadId);
    if (method === "POST") {
      if (owner !== undefined) {
        return send(409, { error: "THREAD_LOCKED", retryable: false });
      }
      locks.set(threadId, runId);
      timeline.push("lock acquired");
      const answer = () =>
        send(200, {
          threadId,
          runId,
          joinToken: "browser-join-token",
          ttlSeconds: 120,
        });
      if (options.holdLockResponse) {
        heldLockAnswers.push(answer);
        return;
      }
      return answer();
    }
    if (method === "PATCH") {
      if (owner !== runId) {
        return send(409, {
          error: "THREAD_LOCK_RENEWAL_FAILED",
          retryable: false,
        });
      }
      return send(200, { ttlSeconds: 120, status: "renewed" });
    }
    if (method === "DELETE") {
      if (options.holdRelease) {
        timeline.push("release held");
        return;
      }
      const released = owner === runId;
      if (released) locks.delete(threadId);
      timeline.push(
        released
          ? "runtime released the lock"
          : "runtime release found no lock",
      );
      return send(200, { threadId, runId, released });
    }
    return send(404, { error: "not found" });
  });

  const sockets = new WebSocketServer({ server });
  sockets.on("connection", (socket: WebSocket, req: IncomingMessage) => {
    const path = new URL(req.url ?? "/", "http://127.0.0.1");
    if (path.pathname.startsWith("/client")) {
      acceptClient(socket, path.searchParams.get("join_token") ?? "");
      return;
    }
    runnerSockets.add(socket);
    socket.on("close", () => runnerSockets.delete(socket));
    let joined: { threadId: string; runId: string } | undefined;
    // The gateway handles a channel's pushes one at a time, in order.
    let queue = Promise.resolve();

    const reply = (
      frame: Frame,
      status: "ok" | "error",
      response: Record<string, unknown> = {},
    ) => {
      const [joinRef, ref, topic] = frame;
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

    const storeBatch = (frame: Frame, events: BaseEvent[]) => {
      if (!joined) return reply(frame, "error", { reason: "not_joined" });
      const { threadId, runId } = joined;
      const types = events.map((event) => event.type).join(" ");
      const refuse = (reason: string, retryable: boolean) => {
        timeline.push(`refused ${types} (${reason})`);
        reply(frame, "error", { reason, retryable });
      };
      batchCount += 1;

      const terminals = events.filter(isTerminal);
      if (terminals.length > 1) {
        return refuse("multiple_terminal_events", false);
      }
      if (terminals.length === 1 && !isTerminal(events[events.length - 1])) {
        return refuse("terminal_event_not_final", false);
      }
      if (options.refuseBatch === batchCount) {
        return refuse("runner_event_thread_too_large", false);
      }

      const fresh = events.filter(
        (event) => !storedEventIds.has(eventId(event)),
      );
      const owner = locks.get(threadId);
      const endsThisRun = terminals.length === 1;
      const markerKey = `${threadId}:${runId}`;
      if (fresh.length > 0) {
        if (owner !== runId && !(owner === undefined && endsThisRun)) {
          return refuse("active_lock_mismatch", false);
        }
        if (terminalMarkers.has(markerKey)) {
          return refuse("runner_event_not_durable", true);
        }
      }

      for (const event of fresh) {
        storedEventIds.add(eventId(event));
        stored.push(event);
        if (event.type === EventType.STATE_SNAPSHOT) {
          snapshots.set(threadId, (event as { snapshot?: unknown }).snapshot);
          deltas.delete(threadId);
        }
        if (event.type === EventType.STATE_DELTA) deltas.add(threadId);
      }
      timeline.push(
        `stored ${types} (lock ${owner === runId ? "held" : "not held"})`,
      );
      const terminal = fresh.find(isTerminal);
      if (terminal) {
        const marker = `${terminal.type}:${eventId(terminal)}`;
        if (owner === runId) {
          terminalMarkers.set(markerKey, marker);
          locks.delete(threadId);
          timeline.push("gateway released the lock");
        } else if (owner === undefined && !terminalMarkers.has(markerKey)) {
          terminalMarkers.set(markerKey, marker);
        }
      }
      reply(frame, "ok");
    };

    socket.on("message", (data) => {
      const frame = JSON.parse(data.toString()) as Frame;
      const [, , topic, event, payload] = frame;
      if (event === "phx_join" && topic.startsWith("ingestion:")) {
        const { thread_id: threadId, run_id: runId } = payload as {
          thread_id: string;
          run_id: string;
        };
        if (options.refuseJoin) {
          timeline.push("join refused");
          return reply(frame, "error", { reason: "thread_not_found" });
        }
        const owner = locks.get(threadId);
        const ended = terminalMarkers.has(`${threadId}:${runId}`);
        if (owner !== runId && !(owner === undefined && ended)) {
          timeline.push("join refused");
          return reply(frame, "error", { reason: "active_lock_mismatch" });
        }
        joined = { threadId, runId };
        timeline.push("runner joined");
        return reply(frame, "ok", {
          capabilities: [RUNNER_EVENT_BATCH_CAPABILITY],
        });
      }
      if (event === "events" || event === "event") {
        const events =
          event === "events"
            ? (payload as { events: BaseEvent[] }).events
            : [payload as BaseEvent];
        pendingBatches += 1;
        queue = queue
          .then(
            () =>
              new Promise<void>((resolve) =>
                setTimeout(resolve, options.storeDelayMs ?? 0),
              ),
          )
          .then(() => {
            pendingBatches -= 1;
            storeBatch(frame, events);
          });
        return;
      }
      reply(frame, "ok");
    });
  });

  /** A browser's thread socket: here it only records a stop. */
  function acceptClient(socket: WebSocket, joinToken: string) {
    if (!joinTokens.delete(joinToken)) {
      socket.close(1008);
      return;
    }
    socket.on("message", (data) => {
      const frame = JSON.parse(data.toString()) as Frame;
      const [joinRef, ref, topic, event, payload] = frame;
      socket.send(
        JSON.stringify([
          joinRef,
          ref,
          topic,
          "phx_reply",
          { status: "ok", response: {} },
        ]),
      );
      if (event !== "stop_run") return;
      const runId = (payload as { run_id: string }).run_id;
      timeline.push(`stop recorded for ${runId}`);
      relayStop(runId);
    });
  }

  function relayStop(runId: string) {
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
  }

  await new Promise<void>((resolve) =>
    server.listen(0, "127.0.0.1", () => resolve()),
  );
  const { port } = server.address() as AddressInfo;

  return {
    apiUrl: `http://127.0.0.1:${port}`,
    wsUrl: `ws://127.0.0.1:${port}`,
    timeline,
    stored,
    /** Batches the gateway has received and not yet stored or refused. */
    pendingBatches: () => pendingBatches,
    /** The run that holds the thread's lock, if any. */
    lockOwner: (threadId: string) => locks.get(threadId),
    /** Sends the stop the gateway relays to the runner after a browser Stop. */
    relayStop,
    /** Every HTTP request the fake received, in order. */
    requests,
    /** Another run takes the thread's lock, as a person's browser run would. */
    takeLock(threadId: string, runId: string) {
      locks.set(threadId, runId);
      timeline.push(`lock taken by ${runId}`);
    },
    /** Sends the lock responses `holdLockResponse` held back. */
    answerLock() {
      for (const answer of heldLockAnswers.splice(0)) answer();
    },
    async close() {
      sockets.clients.forEach((socket) => socket.terminate());
      await new Promise<void>((resolve) => sockets.close(() => resolve()));
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
