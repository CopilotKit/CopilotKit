import type {
  RunAgentInput,
  RunAgentParameters,
  RunAgentResult,
  AgentSubscriber,
  BaseEvent,
} from "@ag-ui/client";
import {
  AbstractAgent,
  EventType,
  randomUUID,
  transformChunks,
  structuredClone_,
} from "@ag-ui/client";

import {
  EMPTY,
  Subject,
  Notification,
  combineLatest,
  defer,
  dematerialize,
  lastValueFrom,
  merge,
  switchMap,
  throwError,
} from "rxjs";
import type { ObservableNotification, Observable } from "rxjs";
import {
  catchError,
  delay,
  endWith,
  filter,
  finalize,
  ignoreElements,
  mergeMap,
  share,
  shareReplay,
  switchMap as switchMapOperator,
  take,
  takeUntil,
  tap,
} from "rxjs/operators";
import { phoenixExponentialBackoff } from "@copilotkit/shared";
import {
  ɵphoenixChannel$,
  ɵphoenixSocket$,
  ɵjoinPhoenixChannel$,
  ɵobservePhoenixSocketSignals$,
  ɵobservePhoenixSocketHealth$,
  ɵobservePhoenixEvent$,
} from "./utils/phoenix-observable";
import type {
  ɵPhoenixChannelLike,
  ɵPhoenixChannelSession,
  ɵPhoenixPushLike,
  ɵPhoenixSocketLike,
  ɵPhoenixSocketSession,
} from "./utils/phoenix-observable";

/**
 * Structural Phoenix socket/channel contracts used by this agent, derived from
 * the minimal `*Like` interfaces in {@link ./utils/phoenix-observable}.
 */
type Socket = ɵPhoenixSocketLike;

interface Channel extends ɵPhoenixChannelLike {
  push(event: string, payload: unknown): ɵPhoenixPushLike;
}

const CLIENT_AG_UI_EVENT = "ag_ui_event";
const REPLAY_COMPLETE_EVENT = "replay_complete";
const STREAM_IDLE_EVENT = "stream_idle";
const STOP_RUN_EVENT = "stop_run";
const CONNECT_STREAM_IDLE_REPLAY_FALLBACK_MS = 100;

interface IntelligenceAgentSharedState {
  lastSeenEventIds: Map<string, string>;
}

interface RealtimeConnectionInfo {
  clientUrl: string;
  topic: string;
}

interface ThreadJoinCredentials {
  threadId: string;
  runId: string | null;
  joinToken: string;
  realtime: RealtimeConnectionInfo;
}

export class AgentThreadLockedError extends Error {
  constructor(threadId?: string) {
    super(threadId ? `Thread ${threadId} is locked` : "Thread is locked");
    this.name = "AgentThreadLockedError";
  }
}

/**
 * Typed contract for agents that expose the completion promise of their
 * currently in-flight run.
 *
 * `IntelligenceAgent` resolves this promise once a run's observable pipeline
 * finalizes (see {@link IntelligenceAgent.connectAgent}). Consumers (e.g. the
 * v2 `CopilotChat` send-serialization path) await it to let an in-flight run —
 * notably an interrupt RESUME — finish before dispatching a new run, instead
 * of pre-empting it.
 *
 * The base `AbstractAgent` from `@ag-ui/client` only declares this property
 * privately, so it is reachable only through this contract plus the
 * {@link isRunCompletionAware} type guard. This keeps callers off `as unknown`
 * casts while still degrading safely for agents that don't implement it.
 */
export interface RunCompletionAware {
  /**
   * Resolves when the active run's pipeline finalizes (completes, errors, or is
   * detached). `undefined` when no run is in flight.
   */
  readonly activeRunCompletionPromise?: Promise<void>;
}

/**
 * Type guard for {@link RunCompletionAware}. Returns true when `agent` exposes
 * an `activeRunCompletionPromise` property, so callers can await an in-flight
 * run without an `as unknown as` cast. Returns false for agents that don't
 * implement the contract, letting the caller skip the await and degrade safely.
 */
export function isRunCompletionAware(
  agent: unknown,
): agent is RunCompletionAware {
  return (
    typeof agent === "object" &&
    agent !== null &&
    "activeRunCompletionPromise" in agent
  );
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
  private canonicalRunId: string | null = null;
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

  /**
   * Override of AbstractAgent.connectAgent that removes the `verifyEvents` step.
   *
   * Background: AbstractAgent's connectAgent pipeline runs events through
   * `verifyEvents`, which validates that the stream follows the AG-UI protocol
   * lifecycle — specifically, it expects a RUN_STARTED event before any content
   * events and a RUN_FINISHED/RUN_ERROR event to complete the stream.
   *
   * IntelligenceAgent uses long-lived WebSocket connections rather than
   * request-scoped SSE streams. When connecting to replay historical messages
   * for an existing thread, the connection semantics don't map to a single
   * agent run start/stop cycle. The replayed events may not include
   * RUN_STARTED/RUN_FINISHED bookends (or may contain events from multiple
   * past runs), which causes verifyEvents to either never complete or to
   * error out.
   *
   * This override replicates the base connectAgent implementation exactly,
   * substituting only `transformChunks` (which is still needed for message
   * reassembly) and omitting `verifyEvents`.
   *
   * TODO: Remove this override once AG-UI's AbstractAgent supports opting out
   * of verifyEvents for transports with different connection life-cycles.
   */
  override async connectAgent(
    parameters?: RunAgentParameters,
    subscriber?: AgentSubscriber,
  ): Promise<RunAgentResult> {
    // Access private fields through a type escape hatch — these are set/read
    // by the base class and must be managed identically to the original.
    // Using `any` because these fields are private in AbstractAgent, and
    // intersecting private+public members of the same name produces `never`.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const self = this as any;

    try {
      this.isRunning = true;
      this.agentId = this.agentId ?? randomUUID();

      const effectiveParameters =
        parameters?.runId || !this.canonicalRunId
          ? parameters
          : {
              ...parameters,
              runId: this.canonicalRunId,
            };
      const input = this.prepareRunAgentInput(effectiveParameters);
      let result: RunAgentResult["result"];
      const previousMessageIds = new Set(this.messages.map((m) => m.id));
      const subscribers: AgentSubscriber[] = [
        {
          onRunFinishedEvent: (event) => {
            if (event.outcome === "success") {
              result = event.result;
            }
          },
        },
        ...this.subscribers,
        subscriber ?? {},
      ];

      await this.onInitialize(input, subscribers);

      self.activeRunDetach$ = new Subject<void>();
      let resolveCompletion: (() => void) | undefined;
      self.activeRunCompletionPromise = new Promise<void>((resolve) => {
        resolveCompletion = resolve;
      });

      const source$ = defer(() => this.connect(input)).pipe(
        // transformChunks reassembles partial/streamed messages — still needed.
        transformChunks(this.debugLogger),
        // NOTE: verifyEvents is intentionally omitted here. See JSDoc above.
        takeUntil(self.activeRunDetach$),
      );

      const applied$ = this.apply(input, source$, subscribers);
      const processed$ = this.processApplyEvents(input, applied$, subscribers);

      await lastValueFrom(
        processed$.pipe(
          catchError((error) => {
            this.isRunning = false;
            return this.onError(input, error, subscribers);
          }),
          finalize(() => {
            this.isRunning = false;
            this.onFinalize(input, subscribers);
            resolveCompletion?.();
            resolveCompletion = undefined;
            self.activeRunCompletionPromise = undefined;
            self.activeRunDetach$ = undefined;
          }),
        ),
        { defaultValue: undefined },
      );

      const newMessages = structuredClone_(this.messages).filter(
        (m) => !previousMessageIds.has(m.id),
      );
      return { result, newMessages };
    } finally {
      this.isRunning = false;
    }
  }

  abortRun(): void {
    if (this.activeChannel && this.canonicalRunId) {
      // Defer cleanup until the push is acknowledged so socket.disconnect()
      // doesn't clear the push buffer before the stop signal is sent.
      // The 5-second fallback handles the case where the socket is down and
      // Phoenix never flushes the buffered push (its .receive("timeout") only
      // fires for pushes that were actually sent but not replied to).
      // detachActiveRun() gracefully tears down the connectAgent() pipeline;
      // cleanup() follows as a safety net for the run() path.
      const fallback = setTimeout(() => clear(), 5_000);
      const clear = () => {
        clearTimeout(fallback);
        void this.detachActiveRun();
        this.cleanup();
      };

      this.activeChannel
        .push(STOP_RUN_EVENT, { run_id: this.canonicalRunId })
        .receive("ok", clear)
        .receive("error", clear)
        .receive("timeout", clear);
    } else {
      void this.detachActiveRun();
      this.cleanup();
    }
  }

  /**
   * Trigger the run via REST, then join the realtime thread channel and relay
   * server-pushed AG-UI events to the Observable subscriber.
   */
  run(input: RunAgentInput): Observable<BaseEvent> {
    this.threadId = input.threadId;
    this.canonicalRunId = input.runId;

    return defer(() => this.requestJoinCredentials$("run", input)).pipe(
      switchMap((credentials) => {
        if (credentials === null) {
          return throwError(
            () => new Error("REST run request returned no credentials"),
          );
        }

        const canonicalInput = this.applyCanonicalRunIdentity(
          input,
          credentials,
          { fallbackToInputRunId: true },
        );

        return this.observeThread$(canonicalInput, credentials, {
          completeOnRunError: false,
          streamMode: "run",
        });
      }),
    );
  }

  /**
   * Reconnect to an existing thread by fetching websocket credentials and
   * joining the realtime thread channel.
   */
  /**
   * Reconnect to an existing thread by fetching websocket credentials
   * and joining the realtime thread channel.
   *
   * Note: this method does NOT clear the replay cursor. Whether to
   * request a full historical replay vs. resume from
   * `lastSeenEventId` is a decision the caller (typically
   * `RunHandler.connectAgent`) makes by calling
   * {@link clearReconnectCursor} ahead of time on a fresh thread
   * restore. Same-thread churn re-connects preserve the cursor so the
   * gateway only streams events past it instead of replaying the
   * entire history every time the chat re-opens a socket.
   */
  protected connect(input: RunAgentInput): Observable<BaseEvent> {
    this.threadId = input.threadId;
    this.canonicalRunId = null;
    const replayCursor = this.getReconnectCursor(input);

    return defer(() =>
      this.requestJoinCredentials$("connect", input, replayCursor),
    ).pipe(
      switchMap((credentials) => {
        if (credentials === null) {
          return EMPTY;
        }

        const canonicalInput = this.applyCanonicalRunIdentity(
          input,
          credentials,
          { fallbackToInputRunId: false },
        );

        return this.observeThread$(canonicalInput, credentials, {
          completeOnRunError: false,
          streamMode: "connect",
          replayCursor,
        });
      }),
    );
  }

  /**
   * Tear down a specific channel + socket pair that belongs to one pipeline.
   * Only nulls instance references when they still point to the owned resource,
   * so a concurrent pipeline's resources are never clobbered.
   */
  private cleanupOwned(
    ownChannel: Channel | null,
    ownSocket: Socket | null,
  ): void {
    if (ownChannel) {
      ownChannel.leave();
      if (this.activeChannel === ownChannel) {
        this.activeChannel = null;
      }
    }
    if (ownSocket) {
      ownSocket.disconnect();
      if (this.socket === ownSocket) {
        this.socket = null;
      }
    }
    this.canonicalRunId = null;
  }

  private cleanup(): void {
    this.cleanupOwned(this.activeChannel, this.socket);
  }

  private requestJoinCredentials$(
    mode: "run" | "connect",
    input: RunAgentInput,
    replayCursor?: string | null,
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
            ...(mode === "connect"
              ? {
                  lastSeenEventId:
                    replayCursor === undefined
                      ? this.getReconnectCursor(input)
                      : replayCursor,
                }
              : {}),
          }),
          ...(this.config.credentials
            ? { credentials: this.config.credentials }
            : {}),
        });

        if (response.status === 204 && mode === "connect") {
          return null;
        }

        if (response.status === 409 && mode === "run") {
          throw new AgentThreadLockedError(input.threadId);
        }

        if (!response.ok) {
          const text = await response.text().catch(() => "");
          throw new Error(
            text || response.statusText || String(response.status),
          );
        }

        return this.normalizeJoinCredentials(await response.json(), input);
      } catch (error) {
        if (error instanceof AgentThreadLockedError) {
          throw error;
        }
        throw new Error(
          `REST ${mode} request failed: ${error instanceof Error ? error.message : String(error)}`,
          { cause: error },
        );
      }
    });
  }

  private normalizeJoinCredentials(
    payload: unknown,
    input: RunAgentInput,
  ): ThreadJoinCredentials {
    const envelope =
      payload && typeof payload === "object"
        ? (payload as Record<string, unknown>)
        : null;
    const realtime =
      envelope?.realtime && typeof envelope.realtime === "object"
        ? (envelope.realtime as Record<string, unknown>)
        : null;

    if (typeof envelope?.joinToken !== "string" || !envelope.joinToken) {
      throw new Error("missing joinToken");
    }

    if (typeof realtime?.clientUrl !== "string" || !realtime.clientUrl) {
      throw new Error("missing realtime.clientUrl");
    }

    if (typeof realtime.topic !== "string" || !realtime.topic) {
      throw new Error("missing realtime.topic");
    }

    return {
      threadId:
        typeof envelope.threadId === "string" && envelope.threadId
          ? envelope.threadId
          : input.threadId,
      runId:
        typeof envelope.runId === "string" && envelope.runId
          ? envelope.runId
          : null,
      joinToken: envelope.joinToken,
      realtime: {
        clientUrl: realtime.clientUrl,
        topic: realtime.topic,
      },
    };
  }

  private observeThread$(
    input: RunAgentInput,
    credentials: ThreadJoinCredentials,
    options: {
      completeOnRunError: boolean;
      streamMode: "run" | "connect";
      channelMode?: "run" | "connect";
      replayCursor?: string | null;
    },
  ): Observable<BaseEvent> {
    return this.observeThreadSession$(input, credentials, options).pipe(
      catchError((error) => {
        if (!this.isSocketReconnectExhaustedError(error)) {
          return throwError(() => error);
        }

        const replayCursor = this.getReconnectCursor(input);
        return this.requestJoinCredentials$(
          "connect",
          input,
          replayCursor,
        ).pipe(
          switchMap((refreshedCredentials) =>
            refreshedCredentials === null
              ? EMPTY
              : this.observeThread$(
                  this.applyCanonicalRunIdentity(input, refreshedCredentials, {
                    fallbackToInputRunId: options.streamMode === "run",
                  }),
                  refreshedCredentials,
                  {
                    ...options,
                    channelMode: "connect",
                    replayCursor,
                  },
                ),
          ),
        );
      }),
    );
  }

  private observeThreadSession$(
    input: RunAgentInput,
    credentials: ThreadJoinCredentials,
    options: {
      completeOnRunError: boolean;
      streamMode: "run" | "connect";
      channelMode?: "run" | "connect";
      replayCursor?: string | null;
    },
  ): Observable<BaseEvent> {
    return defer(() => {
      // Capture references to the socket and channel created by THIS pipeline
      // so the finalize closure only tears down its own resources.  Without
      // this, a fire-and-forget detachActiveRun() from run-handler can race:
      // the old pipeline's deferred cleanup reads from `this.socket` /
      // `this.activeChannel`, which by then may already point to the NEW
      // pipeline's resources — destroying the live connection and preventing
      // the stop signal from ever reaching the backend.
      let ownSocket: Socket | null = null;
      let ownChannel: Channel | null = null;

      const socket$ = ɵphoenixSocket$({
        url: credentials.realtime.clientUrl,
        options: {
          params: {
            ...this.config.socketParams,
            join_token: credentials.joinToken,
          },
          reconnectAfterMs: phoenixExponentialBackoff(100, 10_000),
          rejoinAfterMs: phoenixExponentialBackoff(1_000, 30_000),
        },
      }).pipe(
        tap(({ socket }) => {
          ownSocket = socket as Socket;
          this.socket = ownSocket;
        }),
        shareReplay({ bufferSize: 1, refCount: true }),
      );
      const params = this.createThreadChannelParams(
        input,
        options.channelMode ?? options.streamMode,
        options.replayCursor,
      );
      const channel$ = ɵphoenixChannel$({
        socket$,
        topic: credentials.realtime.topic,
        params,
      }).pipe(
        tap(({ channel }) => {
          ownChannel = channel as Channel;
          this.activeChannel = ownChannel;
        }),
        shareReplay({ bufferSize: 1, refCount: true }),
      );
      const reconnectCursor = this.readDurableEventId(
        options.replayCursor ?? this.getReconnectCursor(input),
      );
      let latestObservedReplayCursor: string | null = null;
      const threadEvents$ = this.observeThreadEvents$(
        input.threadId,
        channel$,
        options,
      ).pipe(
        tap((payload) => {
          latestObservedReplayCursor =
            this.readEventId(payload) ?? latestObservedReplayCursor;
        }),
        share(),
      );
      const replayComplete$ = this.observeControlEvent$(
        input.threadId,
        channel$,
        REPLAY_COMPLETE_EVENT,
      ).pipe(shareReplay({ bufferSize: 1, refCount: true }));
      const streamIdle$ = this.observeControlEvent$(
        input.threadId,
        channel$,
        STREAM_IDLE_EVENT,
      ).pipe(shareReplay({ bufferSize: 1, refCount: true }));
      const streamIdleCompletion$ =
        options.streamMode === "connect"
          ? merge(
              combineLatest([
                replayComplete$.pipe(take(1)),
                streamIdle$.pipe(take(1)),
              ]),
              streamIdle$.pipe(
                take(1),
                filter((payload) =>
                  this.canFallbackCompleteConnect(
                    payload,
                    reconnectCursor,
                    latestObservedReplayCursor,
                  ),
                ),
                delay(CONNECT_STREAM_IDLE_REPLAY_FALLBACK_MS),
              ),
            ).pipe(take(1))
          : EMPTY;
      const threadCompleted$ = threadEvents$.pipe(
        ignoreElements(),
        endWith(null),
        take(1),
      );
      const terminal$ = merge(threadCompleted$, streamIdleCompletion$);

      return merge(
        this.joinThreadChannel$(channel$),
        this.observeSocketHealth$(socket$).pipe(takeUntil(terminal$)),
        threadEvents$.pipe(takeUntil(streamIdleCompletion$)),
        replayComplete$.pipe(ignoreElements(), takeUntil(terminal$)),
        streamIdleCompletion$.pipe(
          ignoreElements(),
          takeUntil(threadCompleted$),
        ),
      ).pipe(finalize(() => this.cleanupOwned(ownChannel, ownSocket)));
    });
  }

  private joinThreadChannel$(
    channel$: Observable<ɵPhoenixChannelSession>,
  ): Observable<never> {
    return ɵjoinPhoenixChannel$(channel$);
  }

  private observeSocketHealth$(
    socket$: Observable<ɵPhoenixSocketSession>,
  ): Observable<never> {
    return ɵobservePhoenixSocketHealth$(
      ɵobservePhoenixSocketSignals$(socket$),
      5,
    );
  }

  private observeThreadEvents$(
    threadId: string,
    channel$: Observable<ɵPhoenixChannelSession>,
    options: { completeOnRunError: boolean; streamMode: "run" | "connect" },
  ): Observable<BaseEvent> {
    return channel$.pipe(
      switchMapOperator(({ channel }) =>
        this.observeChannelEvent$<BaseEvent>(channel, CLIENT_AG_UI_EVENT),
      ),
      tap((payload) => {
        this.updateLastSeenEventId(threadId, payload);
      }),
      mergeMap(
        (payload) =>
          this.createThreadNotifications(payload, {
            completeOnRunError: options.completeOnRunError,
            completeOnRunFinished: options.streamMode === "run",
            errorOnRunError: options.streamMode === "run",
          }) as ObservableNotification<BaseEvent>[],
      ),
      dematerialize(),
    );
  }

  private observeControlEvent$(
    threadId: string,
    channel$: Observable<ɵPhoenixChannelSession>,
    eventName: string,
  ): Observable<unknown> {
    return channel$.pipe(
      switchMapOperator(({ channel }) =>
        this.observeChannelEvent$<unknown>(channel, eventName),
      ),
      tap((payload) =>
        this.updateLastSeenEventIdFromControl(threadId, payload),
      ),
    );
  }

  private observeChannelEvent$<T>(
    channel: ɵPhoenixChannelLike,
    eventName: string,
  ): Observable<T> {
    return ɵobservePhoenixEvent$<T>(channel, eventName);
  }

  private createThreadNotifications(
    payload: BaseEvent,
    options: {
      completeOnRunError: boolean;
      completeOnRunFinished: boolean;
      errorOnRunError: boolean;
    },
  ): Array<Notification<BaseEvent>> {
    if (payload.type === EventType.RUN_FINISHED) {
      return options.completeOnRunFinished
        ? [Notification.createNext(payload), Notification.createComplete()]
        : [Notification.createNext(payload)];
    }

    if (payload.type === EventType.RUN_ERROR) {
      const errorMessage =
        (payload as BaseEvent & { message?: string }).message ?? "Run error";

      return options.completeOnRunError
        ? [Notification.createNext(payload), Notification.createComplete()]
        : options.errorOnRunError
          ? [
              Notification.createNext(payload),
              Notification.createError(new Error(errorMessage)),
            ]
          : [Notification.createNext(payload)];
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

  private createThreadChannelParams(
    input: RunAgentInput,
    streamMode: "run" | "connect",
    replayCursor?: string | null,
  ): Record<string, unknown> {
    return streamMode === "run"
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
  }

  private getLastSeenEventId(threadId: string): string | null {
    return this.sharedState.lastSeenEventIds.get(threadId) ?? null;
  }

  private getReconnectCursor(input: RunAgentInput): string | null {
    return this.getLastSeenEventId(input.threadId);
  }

  /**
   * Drop the cached `lastSeenEventId` cursor for `threadId` so the
   * next connect to that topic asks the gateway for a full historical
   * replay (rather than resuming). Public because
   * `RunHandler.connectAgent` calls it on a detected thread switch
   * to rebuild local state from scratch, and skips it on same-thread
   * churn so the gateway can resume.
   */
  public clearReconnectCursor(threadId: string): void {
    this.sharedState.lastSeenEventIds.delete(threadId);
  }

  private updateLastSeenEventId(threadId: string, payload: BaseEvent): void {
    const eventId = this.readEventId(payload);
    if (!eventId) {
      return;
    }

    this.advanceLastSeenEventId(threadId, eventId);
  }

  private updateLastSeenEventIdFromControl(
    threadId: string,
    payload: unknown,
  ): void {
    const eventId = this.readControlEventId(payload);
    if (!eventId) {
      return;
    }

    this.advanceLastSeenEventId(threadId, eventId);
  }

  private advanceLastSeenEventId(threadId: string, eventId: string): void {
    this.sharedState.lastSeenEventIds.set(threadId, eventId);
  }

  private readEventId(payload: BaseEvent): string | null {
    const metadata = (payload as BaseEvent & { metadata?: unknown }).metadata;
    if (!metadata || typeof metadata !== "object") {
      return null;
    }

    const eventMetadata = metadata as { cpki_event_id?: unknown };
    return this.readDurableEventId(eventMetadata.cpki_event_id);
  }

  private readControlEventId(payload: unknown): string | null {
    if (!payload || typeof payload !== "object") {
      return null;
    }

    const controlPayload = payload as {
      latestEventId?: unknown;
      latest_event_id?: unknown;
    };
    const latestEventId =
      controlPayload.latestEventId ?? controlPayload.latest_event_id;
    return this.readDurableEventId(latestEventId);
  }

  private readDurableEventId(eventId: unknown): string | null {
    if (typeof eventId !== "string" || eventId.trim() === "") {
      return null;
    }

    return eventId.startsWith("cpki_ingested") ? null : eventId;
  }

  private canFallbackCompleteConnect(
    streamIdlePayload: unknown,
    reconnectCursor: string | null,
    latestObservedReplayCursor: string | null,
  ): boolean {
    const idleCursor = this.readControlEventId(streamIdlePayload);
    if (!idleCursor) {
      return true;
    }

    return (
      idleCursor === reconnectCursor ||
      idleCursor === latestObservedReplayCursor
    );
  }

  private applyCanonicalRunIdentity(
    input: RunAgentInput,
    credentials: ThreadJoinCredentials,
    options: { fallbackToInputRunId: boolean },
  ): RunAgentInput {
    this.threadId = credentials.threadId;
    const runId =
      credentials.runId ?? (options.fallbackToInputRunId ? input.runId : null);
    this.canonicalRunId = runId;

    return {
      ...input,
      threadId: credentials.threadId,
      ...(runId === null ? {} : { runId }),
    };
  }

  private isSocketReconnectExhaustedError(error: unknown): boolean {
    return (
      error instanceof Error &&
      error.message.includes("WebSocket connection failed after")
    );
  }
}
