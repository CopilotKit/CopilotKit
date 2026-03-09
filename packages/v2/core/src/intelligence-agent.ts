import {
  AbstractAgent,
  RunAgentInput,
  EventType,
  BaseEvent,
} from "@ag-ui/client";
import {
  EMPTY,
  Notification,
  Observable,
  concat,
  defer,
  dematerialize,
  from,
  merge,
  switchMap,
} from "rxjs";
import {
  endWith,
  finalize,
  ignoreElements,
  mergeMap,
  share,
  take,
  takeUntil,
  tap,
} from "rxjs/operators";
import { Socket, Channel } from "phoenix";
import { phoenixExponentialBackoff } from "@copilotkitnext/shared";
import {
  ɵjoinPhoenixChannel$,
  ɵobservePhoenixChannelEvent$,
  ɵobservePhoenixSocketSignals$,
  ɵobservePhoenixSocketHealth$,
} from "./utils/phoenix-observable";

const CLIENT_AG_UI_EVENT = "ag_ui_event";
const STOP_RUN_EVENT = "stop_run";
interface ThreadJoinCredentials {
  joinToken: string;
}

interface IntelligenceAgentSharedState {
  lastSeenEventIds: Map<string, string>;
}

interface ConnectBootstrapPlan {
  mode: "bootstrap";
  latestEventId: string | null;
  events: BaseEvent[];
}

interface ConnectLivePlan {
  mode: "live";
  joinToken: string;
  joinFromEventId: string | null;
  events: BaseEvent[];
}

type NormalizedConnectPlan = ConnectBootstrapPlan | ConnectLivePlan;

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

    return defer(() => this.requestConnectPlan$(input)).pipe(
      switchMap((plan) => {
        if (plan === null) {
          return EMPTY;
        }

        if (plan.mode === "bootstrap") {
          this.setLastSeenEventId(input.threadId, plan.latestEventId);
          return from(plan.events);
        }

        this.setLastSeenEventId(input.threadId, plan.joinFromEventId);

        return concat(
          from(plan.events),
          this.observeThread$(
            input,
            { joinToken: plan.joinToken },
            {
              completeOnRunError: true,
              streamMode: "connect",
              replayCursor: plan.joinFromEventId,
            },
          ),
        );
      }),
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
    mode: "run",
    input: RunAgentInput,
  ): Observable<ThreadJoinCredentials> {
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

  private requestConnectPlan$(
    input: RunAgentInput,
  ): Observable<NormalizedConnectPlan | null> {
    return defer(async () => {
      try {
        const response = await fetch(this.buildRuntimeUrl("connect"), {
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
            lastSeenEventId: this.getReconnectCursor(input),
          }),
          ...(this.config.credentials
            ? { credentials: this.config.credentials }
            : {}),
        });

        if (response.status === 204) {
          return null;
        }

        if (!response.ok) {
          const text = await response.text().catch(() => "");
          throw new Error(
            text || response.statusText || String(response.status),
          );
        }

        return this.normalizeConnectPlan(await response.json());
      } catch (error) {
        throw new Error(
          `REST connect request failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    });
  }

  private normalizeConnectPlan(payload: unknown): NormalizedConnectPlan {
    const envelope =
      payload && typeof payload === "object"
        ? (payload as Record<string, unknown>)
        : null;

    if (envelope?.mode === "bootstrap") {
      return {
        mode: "bootstrap",
        latestEventId:
          typeof envelope.latestEventId === "string"
            ? envelope.latestEventId
            : null,
        events: Array.isArray(envelope.events)
          ? (envelope.events as BaseEvent[])
          : [],
      };
    }

    if (envelope?.mode === "live") {
      if (
        typeof envelope.joinToken !== "string" ||
        envelope.joinToken.length === 0
      ) {
        throw new Error("missing joinToken");
      }

      return {
        mode: "live",
        joinToken: envelope.joinToken,
        joinFromEventId:
          typeof envelope.joinFromEventId === "string"
            ? envelope.joinFromEventId
            : null,
        events: Array.isArray(envelope.events)
          ? (envelope.events as BaseEvent[])
          : [],
      };
    }

    throw new Error("invalid connect plan");
  }

  private observeThread$(
    input: RunAgentInput,
    credentials: ThreadJoinCredentials,
    options: {
      completeOnRunError: boolean;
      streamMode: "run" | "connect";
      replayCursor?: string | null;
    },
  ): Observable<BaseEvent> {
    return defer(() => {
      const socket = this.createSocket(credentials);
      const channel = this.createThreadChannel(
        socket,
        input,
        options.streamMode,
        options.replayCursor,
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
    return ɵjoinPhoenixChannel$(channel);
  }

  private observeSocketHealth$(socket: Socket): Observable<never> {
    return ɵobservePhoenixSocketHealth$(
      ɵobservePhoenixSocketSignals$(socket),
      5,
    );
  }

  private observeThreadEvents$(
    threadId: string,
    channel: Channel,
    options: { completeOnRunError: boolean },
  ): Observable<BaseEvent> {
    return this.observeChannelEvent$<BaseEvent>(
      channel,
      CLIENT_AG_UI_EVENT,
    ).pipe(
      tap((payload) => {
        this.updateLastSeenEventId(threadId, payload);
      }),
      mergeMap((payload) =>
        from(
          this.createThreadNotifications(payload, options.completeOnRunError),
        ),
      ),
      dematerialize(),
    );
  }

  private observeChannelEvent$<T>(
    channel: Channel,
    eventName: string,
  ): Observable<T> {
    return ɵobservePhoenixChannelEvent$<T>(channel, eventName);
  }

  private createThreadNotifications(
    payload: BaseEvent,
    completeOnRunError: boolean,
  ): Array<Notification<BaseEvent>> {
    if (payload.type === EventType.RUN_FINISHED) {
      return [Notification.createNext(payload), Notification.createComplete()];
    }

    if (payload.type === EventType.RUN_ERROR) {
      const errorMessage =
        (payload as BaseEvent & { message?: string }).message ?? "Run error";

      return completeOnRunError
        ? [Notification.createNext(payload), Notification.createComplete()]
        : [
            Notification.createNext(payload),
            Notification.createError(new Error(errorMessage)),
          ];
    }

    return [Notification.createNext(payload)];
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
    replayCursor?: string | null,
  ): Channel {
    const payload =
      streamMode === "run"
        ? {
            stream_mode: "run",
            run_id: input.runId,
          }
        : {
            stream_mode: "connect",
            last_seen_event_id:
              replayCursor === undefined
                ? this.getReconnectCursor(input)
                : replayCursor,
          };

    return socket.channel(`thread:${input.threadId}`, payload);
  }

  private getLastSeenEventId(threadId: string): string | null {
    return this.sharedState.lastSeenEventIds.get(threadId) ?? null;
  }

  private getReconnectCursor(input: RunAgentInput): string | null {
    return this.hasLocalThreadMessages(input)
      ? this.getLastSeenEventId(input.threadId)
      : null;
  }

  private hasLocalThreadMessages(input: RunAgentInput): boolean {
    return Array.isArray(input.messages) && input.messages.length > 0;
  }

  private updateLastSeenEventId(threadId: string, payload: BaseEvent): void {
    const eventId = this.readEventId(payload);
    if (!eventId) {
      return;
    }

    this.sharedState.lastSeenEventIds.set(threadId, eventId);
  }

  private setLastSeenEventId(threadId: string, eventId: string | null): void {
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
}
