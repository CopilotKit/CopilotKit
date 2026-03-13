import {
  AbstractAgent,
  RunAgentInput,
  EventType,
  BaseEvent,
} from "@ag-ui/client";
import { Observable } from "rxjs";
import { Socket, Channel } from "phoenix";
import {
  AG_UI_CHANNEL_EVENT,
  phoenixExponentialBackoff,
} from "@copilotkit/shared";

export interface IntelligenceAgentConfig {
  /** Phoenix websocket URL, e.g. "ws://localhost:4000/socket" */
  url: string;
  /** Runtime REST URL, e.g. "http://localhost:4000" */
  runtimeUrl: string;
  /** Agent identifier for REST endpoints */
  agentId: string;
  /** Optional params sent on socket connect (e.g. auth token) */
  socketParams?: Record<string, string>;
  /** Optional headers sent with REST requests */
  headers?: Record<string, string>;
  /** Optional credentials mode for fetch requests */
  credentials?: RequestCredentials;
}

export class IntelligenceAgent extends AbstractAgent {
  private config: IntelligenceAgentConfig;
  private socket: Socket | null = null;
  private activeChannel: Channel | null = null;
  private threadId: string | null = null;

  constructor(config: IntelligenceAgentConfig) {
    super();
    this.config = config;
  }

  clone(): IntelligenceAgent {
    return new IntelligenceAgent(this.config);
  }

  abortRun(): void {
    if (this.activeChannel && this.threadId) {
      // Defer cleanup until the push is acknowledged so socket.disconnect()
      // doesn't clear the push buffer before the stop signal is sent.
      // The 5-second fallback handles the case where the socket is down and
      // Phoenix never flushes the buffered push (its .receive("timeout") only
      // fires for pushes that were actually sent but not replied to).
      const fallback = setTimeout(() => this.cleanup(), 5_000);
      const clear = () => {
        clearTimeout(fallback);
        this.cleanup();
      };

      this.activeChannel
        .push(AG_UI_CHANNEL_EVENT, {
          type: EventType.CUSTOM,
          name: "stop",
          value: { threadId: this.threadId },
        })
        .receive("ok", clear)
        .receive("error", clear)
        .receive("timeout", clear);
    } else {
      this.cleanup();
    }
  }

  /**
   * Connect to a Phoenix channel scoped to the thread, trigger the run via
   * REST, and relay server-pushed AG-UI events to the Observable subscriber.
   *
   * The server pushes each AG-UI event using its EventType string as the
   * Phoenix event name (e.g. "TEXT_MESSAGE_CHUNK", "TOOL_CALL_START"), with
   * the full BaseEvent as payload. RUN_FINISHED and RUN_ERROR are terminal
   * events that complete or error the Observable.
   */
  run(input: RunAgentInput): Observable<BaseEvent> {
    return new Observable<BaseEvent>((observer) => {
      this.threadId = input.threadId;

      // 1. Establish socket connection with explicit exponential backoff.
      //
      //    reconnectAfterMs — controls how long Phoenix waits before
      //    reconnecting the underlying WebSocket after an unclean close.
      //    100ms base, doubling up to a 10s cap.
      //
      //    rejoinAfterMs — controls how long Phoenix waits before
      //    re-joining a channel that entered the "errored" state (e.g.
      //    after a socket reconnect). 1s base, doubling up to 30s cap.
      //
      //    These must be set explicitly because the default Phoenix
      //    behaviour uses a stepped (non-exponential) schedule, and —
      //    more importantly — any socket.onError / channel.onError
      //    callback that calls cleanup() / disconnect() will set
      //    `closeWasClean = true` and reset the reconnect timer,
      //    silently disabling all automatic retries.
      const socket = new Socket(this.config.url, {
        params: this.config.socketParams ?? {},
        reconnectAfterMs: phoenixExponentialBackoff(100, 10_000),
        rejoinAfterMs: phoenixExponentialBackoff(1_000, 30_000),
      });
      this.socket = socket;
      socket.connect();

      // 2. Join a channel scoped to this thread/run
      const channel = socket.channel(`agent:${input.threadId}`, {
        runId: input.runId,
      });
      this.activeChannel = channel;

      // 3. Listen for AG-UI events pushed by the server
      channel.on(AG_UI_CHANNEL_EVENT, (payload: BaseEvent) => {
        observer.next(payload);

        if (payload.type === EventType.RUN_FINISHED) {
          observer.complete();
          this.cleanup();
        } else if (payload.type === EventType.RUN_ERROR) {
          observer.error(
            new Error(
              (payload as BaseEvent & { message?: string }).message ??
                "Run error",
            ),
          );
          this.cleanup();
        }
      });

      // 4. Connection error handling — let Phoenix retry automatically.
      //
      //    IMPORTANT: We intentionally do NOT call this.cleanup() in
      //    these handlers. Calling cleanup() triggers socket.disconnect()
      //    which sets closeWasClean = true and resets the reconnect timer,
      //    permanently killing Phoenix's built-in retry loop. Instead we
      //    count consecutive failures and only give up after the threshold.
      //
      //    socket.onOpen resets the counter so transient blips don't
      //    accumulate across successful reconnections.
      const MAX_CONSECUTIVE_ERRORS = 5;
      let consecutiveErrors = 0;

      socket.onError(() => {
        consecutiveErrors++;
        if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
          observer.error(
            new Error(
              `WebSocket connection failed after ${MAX_CONSECUTIVE_ERRORS} consecutive errors`,
            ),
          );
          this.cleanup();
        }
        // Otherwise: Phoenix will automatically attempt to reconnect
        // using the exponential backoff schedule configured above.
      });

      socket.onOpen(() => {
        // A successful (re)connection resets the error counter so that
        // a brief network interruption followed by recovery doesn't
        // count toward the fatal threshold.
        consecutiveErrors = 0;
      });

      // Channel errors (e.g. socket dropped mid-join) trigger an
      // automatic rejoin via Phoenix's rejoinAfterMs timer. We do NOT
      // call cleanup() here — that would leave the channel and cancel
      // the rejoin timer, defeating the retry mechanism.
      channel.onError(() => {
        // No-op: Phoenix handles channel rejoin automatically.
      });

      // 5. Join the channel, then trigger the run via REST
      channel
        .join()
        .receive("ok", () => {
          const { runtimeUrl, agentId, headers, credentials } = this.config;
          const runPath = `${runtimeUrl}/agent/${encodeURIComponent(agentId)}/run`;
          const origin =
            typeof window !== "undefined" && window.location
              ? window.location.origin
              : "http://localhost";
          const runUrl = new URL(runPath, new URL(runtimeUrl, origin));

          fetch(runUrl.toString(), {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              ...headers,
            },
            body: JSON.stringify({
              threadId: input.threadId,
              runId: input.runId,
              messages: input.messages,
              tools: input.tools,
              context: input.context,
              state: input.state,
              forwardedProps: input.forwardedProps,
            }),
            ...(credentials ? { credentials } : {}),
          }).catch((error) => {
            observer.error(
              new Error(`REST run request failed: ${error.message ?? error}`),
            );
            this.cleanup();
          });
        })
        .receive("error", (resp) => {
          observer.error(
            new Error(`Failed to join channel: ${JSON.stringify(resp)}`),
          );
          this.cleanup();
        })
        .receive("timeout", () => {
          observer.error(new Error("Timed out joining channel"));
          this.cleanup();
        });

      // 6. Teardown on unsubscribe
      return () => {
        this.cleanup();
      };
    });
  }

  /**
   * Reconnect to an existing thread by joining the Phoenix channel in
   * "connect" mode and requesting the server replay history.
   */
  protected connect(input: RunAgentInput): Observable<BaseEvent> {
    return new Observable<BaseEvent>((observer) => {
      this.threadId = input.threadId;

      // Same backoff configuration as run() — see comments there for details.
      const socket = new Socket(this.config.url, {
        params: this.config.socketParams ?? {},
        reconnectAfterMs: phoenixExponentialBackoff(100, 10_000),
        rejoinAfterMs: phoenixExponentialBackoff(1_000, 30_000),
      });
      this.socket = socket;
      socket.connect();

      const channel = socket.channel(`agent:${input.threadId}`, {
        mode: "connect",
      });
      this.activeChannel = channel;

      channel.on(AG_UI_CHANNEL_EVENT, (payload: BaseEvent) => {
        observer.next(payload);

        if (
          payload.type === EventType.RUN_FINISHED ||
          payload.type === EventType.RUN_ERROR
        ) {
          observer.complete();
          this.cleanup();
        }
      });

      // Let Phoenix handle transient errors via automatic retry.
      // See run() for detailed explanation of why we don't call cleanup() here.
      const MAX_CONSECUTIVE_ERRORS = 5;
      let consecutiveErrors = 0;

      socket.onError(() => {
        consecutiveErrors++;
        if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
          observer.error(
            new Error(
              `WebSocket connection failed after ${MAX_CONSECUTIVE_ERRORS} consecutive errors`,
            ),
          );
          this.cleanup();
        }
      });

      socket.onOpen(() => {
        consecutiveErrors = 0;
      });

      // No-op: Phoenix handles channel rejoin automatically.
      channel.onError(() => {});

      channel
        .join()
        .receive("ok", () => {
          channel.push(EventType.CUSTOM, {
            type: EventType.CUSTOM,
            name: "connect",
            value: { threadId: input.threadId },
          });
        })
        .receive("error", (resp) => {
          observer.error(
            new Error(`Failed to join channel: ${JSON.stringify(resp)}`),
          );
          this.cleanup();
        })
        .receive("timeout", () => {
          observer.error(new Error("Timed out joining channel"));
          this.cleanup();
        });

      return () => {
        this.cleanup();
      };
    });
  }

  private cleanup(): void {
    if (this.activeChannel) {
      this.activeChannel.leave();
      this.activeChannel = null;
    }
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
    }
  }
}
