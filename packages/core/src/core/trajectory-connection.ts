import { Socket } from "phoenix";
import type { Channel } from "phoenix";
import type { AbstractAgent } from "@ag-ui/client";
import { phoenixExponentialBackoff } from "@copilotkit/shared";
import { createTrajectoryCollector } from "@copilotkit/learning";
import type {
  ConnectionGrant,
  JsonValue,
  StartResult,
  TrajectoryCaptureOptions,
  TrajectoryEvent,
} from "@copilotkit/learning";
import type { CopilotKitCore } from "./core";
import type { CopilotRuntimeTransport } from "../types";
import { abortable, isPromiseLike } from "./header-source";

const TIMEOUT_MS = 10_000;
const BATCH_INTERVAL_MS = 2_000;
const MAX_BATCH_EVENTS = 50;
const MAX_BATCH_BYTES = 64 * 1024;
const MAX_EVENT_BYTES = 16 * 1024;

type WireEvent = TrajectoryEvent<Record<string, JsonValue>>;
interface EventBatch {
  events: WireEvent[];
  dropped: number;
}
const byteLength = (value: unknown) =>
  new TextEncoder().encode(JSON.stringify(value)).byteLength;
const reconnectDelay = phoenixExponentialBackoff(1_000, 10_000);

// Fixed client-side hints. Server messages are never shown in the browser.
const SETUP_HINTS: Record<string, string> = {
  RUNTIME_REQUIRED:
    "Set runtimeUrl: capture connects through the CopilotKit runtime.",
  INTELLIGENCE_RUNTIME_REQUIRED:
    "Configure the CopilotRuntime with `intelligence` to accept capture.",
  CONNECTION_FAILED:
    "Check that the CopilotRuntime is configured with `intelligence` and valid Intelligence credentials, and check the runtime logs.",
  IDENTITY_REQUIRED:
    "The runtime could not identify the user. Configure `identifyUser` on the CopilotRuntime and send the app's session with runtime requests.",
  TRAJECTORIES_NOT_ENABLED:
    "Trajectories are not enabled for this Intelligence project.",
  TRAJECTORIES_UNAVAILABLE:
    "This Intelligence deployment does not serve Trajectory capture.",
  TRAJECTORIES_ENTITLEMENT_UNAVAILABLE:
    "Intelligence could not confirm that Trajectories are enabled for this project; try again later.",
  MARKETPLACE_LICENSE_REQUIRED:
    "Trajectory capture requires a CopilotKit license for this project.",
};

interface PendingPush {
  timer: ReturnType<typeof setTimeout>;
  finish(code?: string, knownRollback?: boolean, flushNext?: boolean): void;
}

interface Connection {
  abort: AbortController;
  timer?: ReturnType<typeof setTimeout>;
  socket?: Socket;
  channel?: Channel;
  socketRefs: string[];
  channelRefs: Array<[string, number]>;
  pending: Set<PendingPush>;
}

interface Session {
  trajectoryId: string;
  config: TrajectoryCaptureOptions;
  promise: Promise<StartResult>;
  resolve(result: StartResult): void;
  collector?: ReturnType<typeof createTrajectoryCollector>;
  connection?: Connection;
  retry?: ReturnType<typeof setTimeout>;
  retries: number;
  queue: WireEvent[];
  flushTimer?: ReturnType<typeof setTimeout>;
  dropped: number;
  ready: boolean;
  started: boolean;
  offline: boolean;
  onOffline(): void;
  onOnline(): void;
  /** Threads already linked to this Trajectory. */
  linkedThreads: Set<string>;
  runWatch?: { unsubscribe(): void };
  agentWatches: Map<AbstractAgent, { unsubscribe(): void }>;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

interface BatchAcknowledgement {
  highestSeq: number | null;
  accepted: number;
  rejected: number;
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isBatchAcknowledgement(
  value: unknown,
  eventCount: number,
): value is BatchAcknowledgement {
  return (
    isObject(value) &&
    isNonNegativeInteger(value.accepted) &&
    isNonNegativeInteger(value.rejected) &&
    value.accepted + value.rejected === eventCount &&
    (value.highestSeq === null || isNonNegativeInteger(value.highestSeq)) &&
    (value.accepted === 0 || value.highestSeq !== null)
  );
}

function isGrant(value: unknown): value is ConnectionGrant {
  return (
    isObject(value) &&
    typeof value.joinToken === "string" &&
    value.joinToken.length > 0 &&
    isObject(value.realtime) &&
    typeof value.realtime.clientUrl === "string" &&
    value.realtime.clientUrl.length > 0 &&
    typeof value.realtime.topic === "string" &&
    value.realtime.topic.length > 0
  );
}

// The Gateway refuses a join with a lowercase reason and no code.
const JOIN_REFUSAL_CODES: Record<string, string> = {
  trajectories_unavailable: "TRAJECTORIES_UNAVAILABLE",
  trajectories_not_enabled: "TRAJECTORIES_NOT_ENABLED",
  entitlement_unavailable: "TRAJECTORIES_ENTITLEMENT_UNAVAILABLE",
  marketplace_license_required: "MARKETPLACE_LICENSE_REQUIRED",
};

function joinErrorCode(value: unknown): string {
  const reason = isObject(value) ? value.reason : undefined;
  const code =
    typeof reason === "string" && Object.hasOwn(JOIN_REFUSAL_CODES, reason)
      ? JOIN_REFUSAL_CODES[reason]
      : undefined;
  return code ?? errorCode(value, "JOIN_FAILED");
}

function errorCode(value: unknown, fallback: string): string {
  return isObject(value) &&
    typeof value.code === "string" &&
    /^[A-Z][A-Z0-9_]{0,63}$/.test(value.code)
    ? value.code
    : fallback;
}

/** Owns bounded, connected-only capture batches. Failed batches are never resent. */
export class TrajectoryConnection {
  private session: Session | undefined;
  private readonly warned = new Set<string>();
  // Core-scoped high water mark prevents collisions after reconnect or stop/start.
  // Gateway drops a seq it already stored for the Trajectory yet acknowledges it
  // as accepted, and a reload or second tab can reuse the id. Starting at the
  // creation time in microseconds keeps later Cores above earlier ones and
  // stays a safe integer until about 2255. Seqs can still collide only if two
  // Cores start the same Trajectory in one millisecond, or if a Core averages
  // more than 1000 events per millisecond, or if the clock goes back.
  private nextSeq = Math.floor(Date.now()) * 1000;

  constructor(
    private readonly core: CopilotKitCore,
    private readonly onChange: () => void,
  ) {}

  get trajectoryId(): string | null {
    return this.session?.ready ? this.session.trajectoryId : null;
  }

  start(
    trajectoryId: string | undefined,
    config: TrajectoryCaptureOptions,
  ): Promise<StartResult> {
    if (
      this.session &&
      (trajectoryId === undefined || trajectoryId === this.session.trajectoryId)
    ) {
      return this.session.promise;
    }
    this.stop();
    const id = trajectoryId ?? crypto.randomUUID();
    let resolveStart!: (result: StartResult) => void;
    const promise = new Promise<StartResult>((resolve) => {
      resolveStart = resolve;
    });
    const session: Session = {
      trajectoryId: id,
      config,
      promise,
      resolve: resolveStart,
      retries: 0,
      queue: [],
      dropped: 0,
      ready: false,
      started: false,
      offline: typeof navigator !== "undefined" && navigator.onLine === false,
      onOffline: () => {
        if (this.session !== session) return;
        session.offline = true;
        if (session.connection)
          this.fail(session, session.connection, "CONNECTION_LOST");
        clearTimeout(session.retry);
        session.retry = undefined;
      },
      onOnline: () => {
        if (this.session !== session) return;
        session.offline = false;
        if (!session.connection) {
          clearTimeout(session.retry);
          session.retry = undefined;
          void this.connect(session);
        }
      },
      linkedThreads: new Set(),
      agentWatches: new Map(),
    };
    this.session = session;
    // Runtime creates the Thread before RUN_STARTED reaches the browser, so a
    // link sent from that event names a Thread that Intelligence can store.
    session.runWatch = this.core.subscribe({
      onAgentRunStarted: ({ agent }) => this.watchAgent(session, agent),
    });
    if (
      typeof window !== "undefined" &&
      typeof window.addEventListener === "function"
    ) {
      window.addEventListener("offline", session.onOffline);
      window.addEventListener("online", session.onOnline);
    }
    if (session.offline) {
      this.report(session, "CONNECTION_LOST");
      this.end(session, { status: "error", code: "CONNECTION_LOST" });
    } else {
      void this.connect(session);
    }
    return promise;
  }

  stop(): void {
    const session = this.session;
    if (!session) return;
    // Drain settled input while this session can still enqueue it, before the
    // best-effort transport flush. Stop stays synchronous and never waits for ACK.
    const collector = session.collector;
    session.collector = undefined;
    collector?.stop();
    if (session.ready && session.connection)
      this.flush(session, session.connection);
    this.end(session, { status: "error", code: "CANCELLED" });
  }

  emit(name: string, value: JsonValue): void {
    const session = this.session;
    if (session?.ready) session.collector?.emit(name, value);
    else if (session?.started) {
      // An explicit developer event during recovery is observable loss. Its
      // contents are discarded immediately; only the count survives reconnect.
      this.addDropped(session, 1, false);
    }
  }

  private watchAgent(session: Session, agent: AbstractAgent): void {
    if (this.session !== session || session.agentWatches.has(agent)) return;
    session.agentWatches.set(
      agent,
      agent.subscribe({
        onRunStartedEvent: ({ event }) => this.linkThread(session, event),
      }),
    );
  }

  /** Sends one `thread.linked` per Thread. A link that cannot be sent waits for the next run. */
  private linkThread(
    session: Session,
    { threadId }: { threadId: string },
  ): void {
    const connection = session.connection;
    if (
      !session.ready ||
      !connection ||
      !threadId ||
      session.linkedThreads.has(threadId)
    )
      return;
    session.linkedThreads.add(threadId);
    // `thread.linked` is a built-in name, so it skips the collector's
    // developer-event check. The host's beforeSend filter still applies.
    const event: TrajectoryEvent = {
      type: "CUSTOM",
      name: "thread.linked",
      timestamp: Date.now(),
      value: { threadId },
    };
    try {
      const { beforeSend } = session.config;
      const kept = beforeSend === undefined ? event : beforeSend(event);
      if (kept !== null) this.send(session, connection, kept);
    } catch {
      this.report(session, "INVALID_EVENT");
    }
  }

  private report(session: Session, code: string): void {
    try {
      session.config.onError?.({
        code,
        message: `Trajectory capture: ${code}.`,
      });
    } catch {
      // Telemetry errors, including a host callback, cannot interrupt the app.
    }
  }

  private current(session: Session, connection: Connection): boolean {
    return this.session === session && session.connection === connection;
  }

  private end(session: Session, result: StartResult): void {
    if (this.session !== session) return;
    this.session = undefined;
    clearTimeout(session.retry);
    session.runWatch?.unsubscribe();
    for (const watch of session.agentWatches.values()) watch.unsubscribe();
    session.agentWatches.clear();
    session.collector?.stop();
    session.ready = false;
    if (session.queue.length > 0) this.report(session, "EVENTS_DROPPED");
    this.discardQueue(session);
    if (session.connection) {
      // Stop prevents retry, but cannot prove whether an in-flight event persisted.
      for (const pending of session.connection.pending) {
        pending.finish("PERSISTENCE_UNKNOWN");
        this.report(session, "PERSISTENCE_UNKNOWN");
      }
      this.cleanup(session, session.connection);
    }
    if (
      typeof window !== "undefined" &&
      typeof window.removeEventListener === "function"
    ) {
      window.removeEventListener("offline", session.onOffline);
      window.removeEventListener("online", session.onOnline);
    }
    if (result.status === "error" && result.code !== "CANCELLED")
      this.warnEnded(session, result.code);
    session.resolve(result);
    this.onChange();
  }

  /**
   * Without an app handler, a capture that ends on its own would otherwise fail
   * silently. Each outcome warns once per Core, so StrictMode replays and
   * repeated starts against the same misconfigured Runtime stay quiet.
   */
  private warnEnded(session: Session, code: string): void {
    if (session.config.onError !== undefined) return;
    const summary = session.started
      ? `Trajectory capture stopped (${code}).`
      : `Trajectory capture did not start (${code}).`;
    if (this.warned.has(summary)) return;
    this.warned.add(summary);
    const hint = SETUP_HINTS[code];
    console.warn(
      `[CopilotKit] ${summary}${hint === undefined ? "" : ` ${hint}`} Set learning.onError to handle capture errors in the app.`,
    );
  }

  private cleanup(session: Session, connection: Connection): void {
    session.connection = undefined;
    clearTimeout(connection.timer);
    connection.abort.abort();
    for (const pending of connection.pending) {
      clearTimeout(pending.timer);
    }
    connection.pending.clear();
    const { socket, channel } = connection;
    try {
      if (channel) {
        for (const [event, ref] of connection.channelRefs)
          channel.off(event, ref);
        // leave() cancels Phoenix's channel rejoin timer and pending join push.
        channel.leave();
      }
    } finally {
      if (socket) {
        socket.off(connection.socketRefs);
        // Phoenix's heartbeat timeout can schedule a reconnect after disconnect
        // returns. Retire this one-use socket; recovery needs a fresh grant.
        socket.connect = () => undefined;
        socket.disconnect();
      }
    }
  }

  private fail(
    session: Session,
    connection: Connection,
    code: string,
    retryable = true,
  ): void {
    if (!this.current(session, connection)) return;
    if (session.ready && session.started) {
      // A new start during recovery must await a fresh join, not an old success.
      session.promise = new Promise((resolve) => {
        session.resolve = resolve;
      });
    }
    // Closing capture may drain a pending edit; it must not reach a failed
    // connection or fill a batch while recovery is discarding queued events.
    session.ready = false;
    session.collector?.stop();
    session.collector = undefined;
    this.discardQueue(session);
    // A discarded or unconfirmed link is sent again on the next run.
    session.linkedThreads.clear();
    for (const pending of connection.pending)
      pending.finish("PERSISTENCE_UNKNOWN");
    if (!this.current(session, connection)) return;
    this.cleanup(session, connection);
    this.onChange();
    this.report(session, code);
    if (this.session !== session) return;
    if (!session.started || !retryable) {
      this.end(session, { status: "error", code });
      return;
    }
    if (session.offline || this.session !== session) return;
    session.retry = setTimeout(
      () => {
        session.retry = undefined;
        if (this.session === session && !session.offline)
          void this.connect(session);
      },
      reconnectDelay(++session.retries),
    );
  }

  private async connect(session: Session): Promise<void> {
    if (this.session !== session || session.offline || session.connection)
      return;
    const connection: Connection = {
      abort: new AbortController(),
      socketRefs: [],
      channelRefs: [],
      pending: new Set(),
    };
    session.connection = connection;
    connection.timer = setTimeout(
      () => this.fail(session, connection, "CONNECTION_TIMEOUT"),
      TIMEOUT_MS,
    );
    try {
      const runtimeUrl = this.core.runtimeUrl;
      if (!runtimeUrl) {
        this.fail(session, connection, "RUNTIME_REQUIRED", false);
        return;
      }
      // "auto" stays unresolved until `/info` answers, and providers start capture
      // right after mount. Wait for detection, or a REST runtime gets a
      // single-endpoint request it cannot route.
      let transport = this.core.runtimeTransport;
      if (transport === "auto") {
        transport = await this.detectedTransport(connection.abort.signal);
        if (!this.current(session, connection)) return;
      }
      const rest = transport === "rest";
      // Resolved fresh, not the last snapshot: with a builder, `core.headers`
      // is `{}` before the first request and an old token after that (#1937).
      // Only an async builder is awaited, so a sync source still sends in the
      // same tick.
      const resolved = this.core.resolveHeaders();
      const coreHeaders = isPromiseLike(resolved)
        ? await abortable(resolved, connection.abort.signal)
        : resolved;
      if (!this.current(session, connection)) return;
      const response = await fetch(
        rest
          ? `${runtimeUrl}/trajectory/${encodeURIComponent(session.trajectoryId)}/connect`
          : (this.core.ɵruntimeEndpointUrl ?? runtimeUrl),
        {
          method: "POST",
          redirect: "error",
          signal: connection.abort.signal,
          headers: { ...coreHeaders, "Content-Type": "application/json" },
          credentials: this.core.credentials,
          body: JSON.stringify(
            rest
              ? {}
              : {
                  method: "trajectory/connect",
                  params: { trajectoryId: session.trajectoryId },
                  body: {},
                },
          ),
        },
      );
      if (!this.current(session, connection)) return;
      const payload: unknown = await response.json().catch(() => undefined);
      if (!this.current(session, connection)) return;
      if (!response.ok) {
        this.fail(
          session,
          connection,
          errorCode(payload, "CONNECTION_FAILED"),
          response.status >= 500 ||
            response.status === 408 ||
            response.status === 429,
        );
        return;
      }
      if (!isGrant(payload)) {
        this.fail(session, connection, "INVALID_GRANT", false);
        return;
      }
      const socket = new Socket(payload.realtime.clientUrl, {
        params: { join_token: payload.joinToken },
        timeout: TIMEOUT_MS,
      });
      connection.socket = socket;
      const lost = () => this.fail(session, connection, "CONNECTION_LOST");
      connection.socketRefs.push(socket.onError(lost), socket.onClose(lost));
      const channel = socket.channel(payload.realtime.topic, {});
      connection.channel = channel;
      connection.channelRefs.push(
        ["phx_error", channel.onError(lost)],
        ["phx_close", channel.onClose(lost)],
      );
      socket.connect();
      if (!this.current(session, connection)) return;
      channel
        .join(TIMEOUT_MS)
        .receive("ok", () => {
          if (!this.current(session, connection)) return;
          try {
            clearTimeout(connection.timer);
            session.ready = true;
            session.retries = 0;
            session.collector = createTrajectoryCollector({
              ...session.config,
              // Exclude SDK transport traffic so capture cannot record its own
              // authorization calls or CopilotKit telemetry and announcements.
              ignoreUrls: [
                ...(session.config.ignoreUrls ?? []),
                ...(this.core.runtimeUrl ? [this.core.runtimeUrl] : []),
                ...(this.core.ɵruntimeEndpointUrl
                  ? [this.core.ɵruntimeEndpointUrl]
                  : []),
                "https://telemetry.copilotkit.ai/",
                "https://cdn.copilotkit.ai/",
              ],
              onError: (error) => {
                if (error.code === "CAPTURE_FAILED")
                  this.fail(session, connection, error.code, false);
                else {
                  if (
                    error.code === "INVALID_EVENT" ||
                    error.code === "EVENT_TOO_LARGE"
                  )
                    this.addDropped(session, 1);
                  session.config.onError?.(error);
                }
              },
              send: (event) => this.send(session, connection, event),
            });
            session.collector.start();
            if (!this.current(session, connection)) return;
            if (session.dropped > 0) this.scheduleFlush(session, connection);
            session.started = true;
            session.resolve({
              status: "started",
              trajectoryId: session.trajectoryId,
            });
            this.onChange();
          } catch {
            this.fail(session, connection, "CAPTURE_FAILED", false);
          }
        })
        .receive("error", (joinError: unknown) =>
          this.fail(session, connection, joinErrorCode(joinError)),
        )
        .receive("timeout", () =>
          this.fail(session, connection, "CONNECTION_TIMEOUT"),
        );
    } catch {
      this.fail(session, connection, "CONNECTION_FAILED");
    }
  }

  /** Resolves once auto-detection picks a transport, or with "auto" when the attempt is aborted. */
  private detectedTransport(signal: AbortSignal) {
    return new Promise<CopilotRuntimeTransport>((resolve) => {
      const finish = () => {
        subscription.unsubscribe();
        signal.removeEventListener("abort", finish);
        resolve(this.core.runtimeTransport);
      };
      const subscription = this.core.subscribe({
        onRuntimeConnectionStatusChanged: () => {
          if (this.core.runtimeTransport !== "auto") finish();
        },
      });
      signal.addEventListener("abort", finish, { once: true });
    });
  }

  private addDropped(session: Session, count: number, schedule = true): void {
    session.dropped = Math.min(
      Number.MAX_SAFE_INTEGER,
      session.dropped + count,
    );
    if (schedule && count > 0 && session.ready && session.connection)
      this.scheduleFlush(session, session.connection);
  }

  private scheduleFlush(session: Session, connection: Connection): void {
    if (session.flushTimer !== undefined || !this.current(session, connection))
      return;
    session.flushTimer = setTimeout(() => {
      session.flushTimer = undefined;
      this.flush(session, connection);
    }, BATCH_INTERVAL_MS);
  }

  private discardQueue(session: Session): void {
    clearTimeout(session.flushTimer);
    session.flushTimer = undefined;
    this.addDropped(session, session.queue.length, false);
    session.queue = [];
  }

  private connected(connection: Connection): boolean {
    return (
      connection.socket?.isConnected() === true &&
      connection.channel?.state === "joined"
    );
  }

  private send(
    session: Session,
    connection: Connection,
    event: TrajectoryEvent,
  ): void {
    if (!this.current(session, connection)) return;
    if (!session.ready) {
      this.addDropped(session, 1, false);
      return;
    }
    if (!this.connected(connection)) {
      this.addDropped(session, 1);
      this.fail(session, connection, "CONNECTION_LOST");
      return;
    }
    if (!Number.isSafeInteger(this.nextSeq)) {
      this.addDropped(session, 1);
      this.report(session, "SEQUENCE_EXHAUSTED");
      return;
    }
    const original = event.value;
    const fields =
      isObject(original) &&
      !Array.isArray(original) &&
      !Object.hasOwn(original, "seq")
        ? (original as Record<string, JsonValue>)
        : { data: original };
    const wire: WireEvent = {
      ...event,
      value: { ...fields, seq: this.nextSeq++ },
    };
    if (byteLength(wire) > MAX_EVENT_BYTES) {
      this.addDropped(session, 1);
      this.report(session, "EVENT_TOO_LARGE");
      return;
    }
    // Reserve the maximum dropped-counter width so later local losses cannot
    // grow an already-full payload over the wire limit.
    const fits = () =>
      session.queue.length < MAX_BATCH_EVENTS &&
      byteLength({
        events: [...session.queue, wire],
        dropped: Number.MAX_SAFE_INTEGER,
      }) <= MAX_BATCH_BYTES;
    if (!fits()) this.flush(session, connection);
    if (!this.current(session, connection) || !session.ready) return;
    if (!fits()) {
      this.addDropped(session, 1);
      this.report(session, "EVENTS_DROPPED");
      return;
    }
    session.queue.push(wire);
    if (session.queue.length === MAX_BATCH_EVENTS)
      this.flush(session, connection);
    else this.scheduleFlush(session, connection);
  }

  private flush(session: Session, connection: Connection): void {
    if (
      !this.current(session, connection) ||
      !session.ready ||
      (session.queue.length === 0 && session.dropped === 0)
    )
      return;
    if (!this.connected(connection)) {
      this.fail(session, connection, "CONNECTION_LOST");
      return;
    }
    // One in-flight batch and one bounded queue; never let Phoenix buffer offline.
    if (connection.pending.size > 0) return;
    clearTimeout(session.flushTimer);
    session.flushTimer = undefined;
    const batch: EventBatch = {
      events: session.queue,
      dropped: session.dropped,
    };
    session.queue = [];
    session.dropped = 0;
    let finished = false;
    const pending: PendingPush = {
      timer: setTimeout(
        () => pending.finish("PERSISTENCE_UNKNOWN"),
        TIMEOUT_MS,
      ),
      finish: (code, knownRollback = false, flushNext = true) => {
        if (finished) return;
        finished = true;
        clearTimeout(pending.timer);
        connection.pending.delete(pending);
        // A missing ACK may already be accepted by Redis. Never count uncertainty
        // as a known drop, and never replay a batch or its dropped counter.
        if (knownRollback)
          this.addDropped(session, batch.events.length + batch.dropped, false);
        if (code && this.current(session, connection))
          this.report(session, code);
        if (
          flushNext &&
          this.current(session, connection) &&
          session.ready &&
          (session.queue.length > 0 || (!knownRollback && session.dropped > 0))
        )
          this.flush(session, connection);
      },
    };
    connection.pending.add(pending);
    try {
      connection
        .channel!.push("events", batch, TIMEOUT_MS)
        .receive("ok", (payload: unknown) => {
          // Rejected rows are already counted by Gateway; don't also mark them
          // as client drops. The aggregate reply cannot identify rejected rows.
          pending.finish(
            !isBatchAcknowledgement(payload, batch.events.length)
              ? "PERSISTENCE_UNKNOWN"
              : payload.rejected > 0
                ? "EVENTS_REJECTED"
                : undefined,
          );
        })
        .receive("error", (payload: unknown) => {
          if (!this.current(session, connection)) return;
          const reason = isObject(payload) ? payload.reason : undefined;
          if (reason === "unauthorized" || reason === "trajectory_mismatch") {
            // Finish the known rollback without flushing the queued tail onto
            // a channel whose scope has just been refused.
            pending.finish(undefined, true, false);
            this.fail(session, connection, reason.toUpperCase(), false);
            return;
          }
          const rollback =
            typeof reason === "string" &&
            [
              "invalid_batch",
              "batch_too_large",
              "batch_too_many_events",
              "trajectory_over_share",
              "trajectory_outbox_full",
              "unsupported_event",
            ].includes(reason);
          // storage_unavailable includes Redis timeouts after a possible write.
          // retryable:true cannot make a repeated dropped counter idempotent.
          pending.finish(
            rollback ? (reason as string).toUpperCase() : "PERSISTENCE_UNKNOWN",
            rollback,
          );
        })
        .receive("timeout", () => pending.finish("PERSISTENCE_UNKNOWN"));
    } catch {
      pending.finish("PERSISTENCE_UNKNOWN");
    }
  }
}
