import {
  AbstractAgent,
  RunAgentInput,
  EventType,
  BaseEvent,
  MetaEvent,
} from "@ag-ui/client";
import {
  EMPTY,
  Notification,
  Observable,
  defer,
  dematerialize,
  from,
  merge,
  switchMap,
} from "rxjs";
import {
  filter,
  endWith,
  finalize,
  ignoreElements,
  map,
  mergeMap,
  scan,
  share,
  take,
  takeUntil,
  tap,
} from "rxjs/operators";
import { Socket, Channel } from "phoenix";
import { phoenixExponentialBackoff } from "@copilotkitnext/shared";

const CLIENT_AG_UI_EVENT = "ag_ui_event";
const STOP_RUN_EVENT = "stop_run";
const REPLAY_COMPLETE_META_TYPE = "replay_complete";

interface ThreadJoinCredentials {
  joinToken: string;
}

interface IntelligenceAgentSharedState {
  lastSeenEventIds: Map<string, string>;
}

interface ThreadStreamState {
  isReplaying: boolean;
  notifications: Array<Notification<BaseEvent>>;
}

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
  private runId: string | null = null;
  private sharedState: IntelligenceAgentSharedState;

  constructor(
    config: IntelligenceAgentConfig,
    sharedState: IntelligenceAgentSharedState = {
      lastSeenEventIds: new Map<string, string>(),
    },
  ) {
    super();
    this.config = config;
    this.sharedState = sharedState;
  }

  clone(): IntelligenceAgent {
    return new IntelligenceAgent(this.config, this.sharedState);
  }

  abortRun(): void {
    if (this.activeChannel && this.runId) {
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
        .push(STOP_RUN_EVENT, { run_id: this.runId })
        .receive("ok", clear)
        .receive("error", clear)
        .receive("timeout", clear);
    } else {
      this.cleanup();
    }
  }

  /**
   * Trigger the run via REST, then join the realtime thread channel and relay
   * server-pushed AG-UI events to the Observable subscriber.
   */
  run(input: RunAgentInput): Observable<BaseEvent> {
    this.threadId = input.threadId;
    this.runId = input.runId;

    return defer(() => this.requestJoinCredentials$("run", input)).pipe(
      switchMap((credentials) =>
        this.observeThread$(input, credentials, {
          completeOnRunError: false,
          streamMode: "run",
        }),
      ),
    );
  }

  /**
   * Reconnect to an existing thread by fetching websocket credentials and
   * joining the realtime thread channel.
   */
  protected connect(input: RunAgentInput): Observable<BaseEvent> {
    this.threadId = input.threadId;
    this.runId = input.runId;

    return defer(() => this.requestJoinCredentials$("connect", input)).pipe(
      switchMap((credentials) =>
        credentials === null
          ? EMPTY
          : this.observeThread$(input, credentials, {
              completeOnRunError: true,
              streamMode: "connect",
            }),
      ),
    );
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
    this.runId = null;
  }

  private requestJoinCredentials$(
    mode: "run" | "connect",
    input: RunAgentInput,
  ): Observable<ThreadJoinCredentials | null> {
    return defer(async () => {
      try {
        const response = await fetch(this.buildRuntimeUrl(mode), {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...this.config.headers,
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
          ...(this.config.credentials
            ? { credentials: this.config.credentials }
            : {}),
        });

        if (response.status === 204 && mode === "connect") {
          return null;
        }

        if (!response.ok) {
          const text = await response.text().catch(() => "");
          throw new Error(
            text || response.statusText || String(response.status),
          );
        }

        const payload =
          (await response.json()) as Partial<ThreadJoinCredentials>;
        if (!payload.joinToken) {
          throw new Error("missing joinToken");
        }

        return { joinToken: payload.joinToken };
      } catch (error) {
        throw new Error(
          `REST ${mode} request failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    });
  }

  private observeThread$(
    input: RunAgentInput,
    credentials: ThreadJoinCredentials,
    options: { completeOnRunError: boolean; streamMode: "run" | "connect" },
  ): Observable<BaseEvent> {
    return defer(() => {
      const socket = this.createSocket(credentials);
      const channel = this.createThreadChannel(
        socket,
        input,
        options.streamMode,
      );
      const threadEvents$ = this.observeThreadEvents$(
        input.threadId,
        channel,
        options,
      ).pipe(share());
      const threadCompleted$ = threadEvents$.pipe(
        ignoreElements(),
        endWith(null),
        take(1),
      );

      this.socket = socket;
      this.activeChannel = channel;
      socket.connect();

      return merge(
        this.joinThreadChannel$(channel),
        this.observeSocketHealth$(socket).pipe(takeUntil(threadCompleted$)),
        threadEvents$,
      ).pipe(finalize(() => this.cleanup()));
    });
  }

  private createSocket(credentials: ThreadJoinCredentials): Socket {
    return new Socket(this.config.url, {
      params: {
        ...(this.config.socketParams ?? {}),
        join_token: credentials.joinToken,
      },
      reconnectAfterMs: phoenixExponentialBackoff(100, 10_000),
      rejoinAfterMs: phoenixExponentialBackoff(1_000, 30_000),
    });
  }

  private joinThreadChannel$(channel: Channel): Observable<never> {
    return new Observable<void>((observer) => {
      channel
        .join()
        .receive("ok", () => observer.complete())
        .receive("error", (response: unknown) => {
          observer.error(
            new Error(`Failed to join channel: ${JSON.stringify(response)}`),
          );
        })
        .receive("timeout", () => {
          observer.error(new Error("Timed out joining channel"));
        });
    }).pipe(ignoreElements());
  }

  private observeSocketHealth$(socket: Socket): Observable<never> {
    const maxConsecutiveErrors = 5;

    return merge(
      this.observeSocketOpen$(socket).pipe(map(() => "open" as const)),
      this.observeSocketError$(socket).pipe(map(() => "error" as const)),
    ).pipe(
      scan(
        (consecutiveErrors, eventType) =>
          eventType === "open" ? 0 : consecutiveErrors + 1,
        0,
      ),
      filter((consecutiveErrors) => consecutiveErrors >= maxConsecutiveErrors),
      take(1),
      mergeMap((consecutiveErrors) => {
        throw new Error(
          `WebSocket connection failed after ${consecutiveErrors} consecutive errors`,
        );
      }),
    );
  }

  private observeSocketOpen$(socket: Socket): Observable<void> {
    return new Observable<void>((observer) => {
      socket.onOpen(() => observer.next());
    });
  }

  private observeSocketError$(socket: Socket): Observable<unknown> {
    return new Observable<unknown>((observer) => {
      socket.onError((error) => observer.next(error));
    });
  }

  private observeThreadEvents$(
    threadId: string,
    channel: Channel,
    options: { completeOnRunError: boolean },
  ): Observable<BaseEvent> {
    const initialState: ThreadStreamState = {
      isReplaying: options.completeOnRunError,
      notifications: [],
    };

    return this.observeChannelEvent$<BaseEvent>(
      channel,
      CLIENT_AG_UI_EVENT,
    ).pipe(
      tap((payload) => {
        if (!this.isMetaEvent(payload)) {
          this.updateLastSeenEventId(threadId, payload);
        }
      }),
      scan(
        (state, payload) =>
          this.reduceThreadEvent(state, payload, options.completeOnRunError),
        initialState,
      ),
      mergeMap((state) => from(state.notifications)),
      dematerialize(),
      filter((payload) => !this.isMetaEvent(payload)),
    );
  }

  private observeChannelEvent$<T>(
    channel: Channel,
    eventName: string,
  ): Observable<T> {
    return new Observable<T>((observer) => {
      channel.on(eventName, (payload: T) => observer.next(payload));
      channel.onError(() => {});
    });
  }

  private reduceThreadEvent(
    state: ThreadStreamState,
    payload: BaseEvent,
    completeOnRunError: boolean,
  ): ThreadStreamState {
    if (this.isReplayCompleteMetaEvent(payload)) {
      if (this.readReplayCompleteActiveRun(payload)) {
        return { isReplaying: false, notifications: [] };
      }

      return {
        isReplaying: false,
        notifications: [Notification.createComplete()],
      };
    }

    if (this.isMetaEvent(payload)) {
      return {
        isReplaying: state.isReplaying,
        notifications: [],
      };
    }

    if (payload.type === EventType.RUN_FINISHED && !state.isReplaying) {
      return {
        isReplaying: false,
        notifications: [
          Notification.createNext(payload),
          Notification.createComplete(),
        ],
      };
    }

    if (payload.type === EventType.RUN_ERROR && !state.isReplaying) {
      const errorMessage =
        (payload as BaseEvent & { message?: string }).message ?? "Run error";

      return {
        isReplaying: false,
        notifications: completeOnRunError
          ? [Notification.createNext(payload), Notification.createComplete()]
          : [
              Notification.createNext(payload),
              Notification.createError(new Error(errorMessage)),
            ],
      };
    }

    return {
      isReplaying: state.isReplaying,
      notifications: [Notification.createNext(payload)],
    };
  }

  private buildRuntimeUrl(mode: "run" | "connect"): string {
    const path = `${this.config.runtimeUrl}/agent/${encodeURIComponent(this.config.agentId)}/${mode}`;
    const origin =
      typeof window !== "undefined" && window.location
        ? window.location.origin
        : "http://localhost";

    return new URL(path, new URL(this.config.runtimeUrl, origin)).toString();
  }

  private createThreadChannel(
    socket: Socket,
    input: RunAgentInput,
    streamMode: "run" | "connect",
  ): Channel {
    const payload =
      streamMode === "run"
        ? {
            stream_mode: "run",
            run_id: input.runId,
          }
        : {
            stream_mode: "connect",
            last_seen_event_id: this.getLastSeenEventId(input.threadId),
          };

    return socket.channel(`thread:${input.threadId}`, payload);
  }

  private getLastSeenEventId(threadId: string): string | null {
    return this.sharedState.lastSeenEventIds.get(threadId) ?? null;
  }

  private updateLastSeenEventId(threadId: string, payload: BaseEvent): void {
    const eventId = this.readEventId(payload);
    if (!eventId) {
      return;
    }

    this.sharedState.lastSeenEventIds.set(threadId, eventId);
  }

  private readEventId(payload: BaseEvent): string | null {
    const metadata = (payload as BaseEvent & { metadata?: unknown }).metadata;
    if (!metadata || typeof metadata !== "object") {
      return null;
    }

    const runnerEventId = (metadata as { cpki_event_id?: unknown })
      .cpki_event_id;
    return typeof runnerEventId === "string" ? runnerEventId : null;
  }

  private isMetaEvent(payload: BaseEvent): payload is MetaEvent {
    return payload.type === EventType.META;
  }

  private isReplayCompleteMetaEvent(payload: BaseEvent): payload is MetaEvent {
    return (
      this.isMetaEvent(payload) &&
      payload.metaType === REPLAY_COMPLETE_META_TYPE
    );
  }

  private readReplayCompleteActiveRun(payload: MetaEvent): boolean {
    const envelope = payload.payload;

    if (!envelope || typeof envelope !== "object") {
      return false;
    }

    const activeRun = (envelope as { active_run?: unknown }).active_run;
    return activeRun === true;
  }
}
