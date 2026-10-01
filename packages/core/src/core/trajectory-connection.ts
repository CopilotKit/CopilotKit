import { Socket } from "phoenix";
import type { Channel } from "phoenix";
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

const TIMEOUT_MS = 10_000;
const reconnectDelay = phoenixExponentialBackoff(1_000, 10_000);

interface PendingPush {
  timer: ReturnType<typeof setTimeout>;
  finish(code?: string): void;
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
  ready: boolean;
  started: boolean;
  offline: boolean;
  onOffline(): void;
  onOnline(): void;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
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

function errorCode(value: unknown, fallback: string): string {
  return isObject(value) &&
    typeof value.code === "string" &&
    /^[A-Z][A-Z0-9_]{0,63}$/.test(value.code)
    ? value.code
    : fallback;
}

/** Owns a threadless capture connection. Events are never queued or resent. */
export class TrajectoryConnection {
  private session: Session | undefined;

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
    };
    this.session = session;
    if (typeof window !== "undefined") {
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
    if (this.session)
      this.end(this.session, { status: "error", code: "CANCELLED" });
  }

  emit(name: string, value: JsonValue): void {
    if (this.session?.ready) this.session.collector?.emit(name, value);
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
    session.collector?.stop();
    session.ready = false;
    if (session.connection) {
      // Stop prevents retry, but cannot prove whether an in-flight event persisted.
      for (const _pending of session.connection.pending)
        this.report(session, "PERSISTENCE_UNKNOWN");
      this.cleanup(session, session.connection);
    }
    if (typeof window !== "undefined") {
      window.removeEventListener("offline", session.onOffline);
      window.removeEventListener("online", session.onOnline);
    }
    session.resolve(result);
    this.onChange();
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
        // A token is consumed on socket connection. Never let Phoenix reconnect
        // this socket; a new attempt must first obtain a new Runtime grant.
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
    session.collector?.stop();
    session.collector = undefined;
    if (session.ready && session.started) {
      // A new start during recovery must await a fresh join, not an old success.
      session.promise = new Promise((resolve) => {
        session.resolve = resolve;
      });
    }
    session.ready = false;
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
      const rest = this.core.runtimeTransport === "rest";
      const response = await fetch(
        rest
          ? `${runtimeUrl}/trajectory/${encodeURIComponent(session.trajectoryId)}/connect`
          : (this.core.ɵruntimeEndpointUrl ?? runtimeUrl),
        {
          method: "POST",
          redirect: "error",
          signal: connection.abort.signal,
          headers: { ...this.core.headers, "Content-Type": "application/json" },
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
              onError: (error) => {
                if (error.code === "CAPTURE_FAILED")
                  this.fail(session, connection, error.code, false);
                else session.config.onError?.(error);
              },
              send: (event) => this.send(session, connection, event),
            });
            session.collector.start();
            if (!this.current(session, connection)) return;
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
          this.fail(session, connection, errorCode(joinError, "JOIN_FAILED")),
        )
        .receive("timeout", () =>
          this.fail(session, connection, "CONNECTION_TIMEOUT"),
        );
    } catch {
      this.fail(session, connection, "CONNECTION_FAILED");
    }
  }

  private send(
    session: Session,
    connection: Connection,
    event: TrajectoryEvent,
  ): void {
    if (!this.current(session, connection) || !session.ready) return;
    const { socket, channel } = connection;
    if (!socket?.isConnected() || channel?.state !== "joined") {
      this.fail(session, connection, "CONNECTION_LOST");
      return;
    }
    let finished = false;
    const pending: PendingPush = {
      timer: setTimeout(
        () => pending.finish("PERSISTENCE_UNKNOWN"),
        TIMEOUT_MS,
      ),
      finish: (code) => {
        if (finished) return;
        finished = true;
        clearTimeout(pending.timer);
        connection.pending.delete(pending);
        if (code && this.current(session, connection))
          this.report(session, code);
      },
    };
    connection.pending.add(pending);
    try {
      channel
        .push("trajectory.event", event, TIMEOUT_MS)
        .receive("ok", (payload: unknown) => {
          const persisted =
            isObject(payload) &&
            payload.status === "persisted" &&
            typeof payload.eventId === "string" &&
            payload.eventId.length > 0;
          pending.finish(persisted ? undefined : "PERSISTENCE_UNKNOWN");
        })
        .receive("error", (payload: unknown) => {
          const code = errorCode(payload, "PERSISTENCE_UNKNOWN");
          pending.finish(
            [
              "INVALID_EVENT",
              "EVENT_TOO_LARGE",
              "PERSISTENCE_FAILED",
              "PERSISTENCE_UNKNOWN",
            ].includes(code)
              ? code
              : "PERSISTENCE_UNKNOWN",
          );
        })
        .receive("timeout", () => pending.finish("PERSISTENCE_UNKNOWN"));
    } catch {
      pending.finish("PERSISTENCE_UNKNOWN");
    }
  }
}
