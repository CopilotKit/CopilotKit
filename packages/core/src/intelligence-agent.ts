import type {
  RunAgentInput,
  RunAgentParameters,
  RunAgentResult,
  AgentSubscriber,
  AgentStateMutation,
  BaseEvent,
} from "@ag-ui/client";
import {
  AbstractAgent,
  EventType,
  structuredClone_,
  transformChunks,
} from "@ag-ui/client";

import {
  EMPTY,
  Observable,
  Notification,
  Subject,
  combineLatest,
  from,
  lastValueFrom,
  defer,
  dematerialize,
  merge,
  switchMap,
  throwError,
} from "rxjs";
import type { ObservableNotification } from "rxjs";
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
import { ɵconnectWithoutEventVerification } from "./utils/connect-replay";
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

const globalFetch: typeof fetch = (...args) => fetch(...args);

const CLIENT_AG_UI_EVENT = "ag_ui_event";
const REPLAY_COMPLETE_EVENT = "replay_complete";
const STREAM_IDLE_EVENT = "stream_idle";
const STOP_RUN_EVENT = "stop_run";
const CONNECT_STREAM_IDLE_REPLAY_FALLBACK_MS = 100;
// Credential refreshes allowed in a row for sockets that never opened. Past this,
// the run fails instead of waiting on a realtime endpoint that is not answering.
const MAX_UNOPENED_CREDENTIAL_REFRESHES = 2;

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
  /** Runtime base URL, e.g. "http://localhost:4000" */
  runtimeUrl: string;
  /** HTTP transport for run/connect requests. Defaults to REST. */
  transport?: "rest" | "single";
  /** Agent identifier for REST endpoints */
  agentId: string;
  /** Optional params sent on socket connect (e.g. auth token) */
  socketParams?: Record<string, string>;
  /** Opt in only when the gateway enables acknowledged, disk-staged replay. */
  replayProtocol?: "bounded_v1";
  /** Optional headers sent with REST requests */
  headers?: Record<string, string>;
  /** Optional credentials mode for fetch requests */
  credentials?: RequestCredentials;
  fetch?: typeof fetch;
}

export class IntelligenceAgent extends AbstractAgent {
  private config: IntelligenceAgentConfig;
  private replayApplications = new WeakMap<
    BaseEvent,
    (input: RunAgentInput, subscribers: AgentSubscriber[]) => Promise<void>
  >();
  private replaySettled: Promise<void> = Promise.resolve();
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

  /**
   * Headers sent with the REST join requests (`/connect`, `/run`).
   *
   * Deliberately a public accessor pair rather than a plain read of `config`.
   * `ProxiedCopilotRuntimeAgent` builds its delegate once and caches it for the
   * proxy's lifetime, so a header that changes later (a tenant switch, a
   * rotated bearer) would otherwise never reach the gateway. The accessor is
   * what closes that gap: `syncDelegate` refreshes the delegate before every
   * join, and its `hasHeaders` probe is an `"headers" in agent` check — which a
   * prototype accessor satisfies but a `private config` does not.
   *
   * The setter replaces the config object instead of mutating it because
   * `clone()` hands the same config reference to the copy. An in-place write
   * would therefore have a per-thread clone's headers land on the original's
   * config too. The join path itself would survive that (`syncDelegate`
   * rewrites the headers just before every join), but the re-acquisition inside
   * an already-running pipeline does not go through `syncDelegate` — so a
   * clone's tenant could ride out on the original's socket-error refresh. That
   * is the same cross-tenant leak this accessor exists to prevent.
   */
  get headers(): Record<string, string> | undefined {
    return this.config.headers;
  }

  set headers(headers: Record<string, string> | undefined) {
    this.config = { ...this.config, headers };
  }

  /** Credentials mode for the REST join requests. Live for the same reason as {@link headers}. */
  get credentials(): RequestCredentials | undefined {
    return this.config.credentials;
  }

  set credentials(credentials: RequestCredentials | undefined) {
    this.config = { ...this.config, credentials };
  }

  clone(): IntelligenceAgent {
    return new IntelligenceAgent(this.config, this.sharedState);
  }

  /**
   * Override of AbstractAgent.connectAgent that removes the `verifyEvents` step.
   *
   * IntelligenceAgent uses long-lived WebSocket connections rather than
   * request-scoped SSE streams. When connecting to replay historical messages
   * for an existing thread, the connection semantics don't map to a single
   * agent run start/stop cycle: the replayed events may omit the
   * RUN_STARTED/RUN_FINISHED bookends, or carry events from several past runs,
   * either of which makes `verifyEvents` stall or error out.
   *
   * See {@link ɵconnectWithoutEventVerification} for the pipeline itself, which
   * the self-hosted `/connect` path shares for the same reason.
   */
  override async connectAgent(
    parameters?: RunAgentParameters,
    subscriber?: AgentSubscriber,
  ): Promise<RunAgentResult> {
    await this.replaySettled;
    // A run already in flight owns the canonical run id; reuse it so the
    // replay is attributed to that run rather than minting a new one.
    const effectiveParameters =
      parameters?.runId || !this.canonicalRunId
        ? parameters
        : {
            ...parameters,
            runId: this.canonicalRunId,
          };

    try {
      return await ɵconnectWithoutEventVerification(
        this,
        effectiveParameters,
        subscriber,
      );
    } finally {
      await this.replaySettled;
    }
  }

  /** Detach completes only after cancelled replay callbacks settle and rollback finishes. */
  override async detachActiveRun(): Promise<void> {
    await super.detachActiveRun();
    await this.replaySettled;
  }

  /** Private frame events isolate each acknowledged application from cancelled sessions. */
  protected override apply(
    input: RunAgentInput,
    events$: Observable<BaseEvent>,
    subscribers: AgentSubscriber[],
  ): Observable<AgentStateMutation> {
    if (this.config.replayProtocol !== "bounded_v1") {
      return super.apply(input, events$, subscribers);
    }
    return super.apply(input, events$, [
      {
        onEvent: async ({ event }) => {
          const apply = this.replayApplications.get(event);
          if (apply) {
            this.replayApplications.delete(event);
            await apply(input, subscribers);
            return { stopPropagation: true };
          }
        },
      },
      ...subscribers,
    ]);
  }

  /** Apply one frame from current committed state, awaiting notification callbacks as well. */
  private async applyReplayFrame(
    input: RunAgentInput,
    events: BaseEvent[],
    subscribers: AgentSubscriber[],
    active: () => boolean,
  ): Promise<void> {
    const callbacks: Promise<{ error: unknown } | undefined>[] = [];
    const track = (result: unknown) => {
      callbacks.push(
        Promise.resolve(result).then(
          () => undefined,
          (error: unknown) => ({ error }),
        ),
      );
    };
    const currentInput = { ...input, state: structuredClone_(this.state) };
    const applied$ = super
      .apply(currentInput, from(events), subscribers)
      .pipe(filter(active));
    const application = await lastValueFrom(
      super.processApplyEvents(
        currentInput,
        applied$,
        subscribers.map((subscriber) => ({
          ...subscriber,
          onMessagesChanged: (parameters) =>
            track(subscriber.onMessagesChanged?.(parameters)),
          onStateChanged: (parameters) =>
            track(subscriber.onStateChanged?.(parameters)),
        })),
      ),
      { defaultValue: undefined },
    ).then(
      () => undefined,
      (error: unknown) => ({ error }),
    );
    const results = await Promise.all(callbacks);
    const failed =
      application ?? results.find((result) => result !== undefined);
    if (failed) throw failed.error;
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
        const requestFetch = this.config.fetch ?? globalFetch;
        const body = {
          ...input,
          ...(mode === "connect"
            ? {
                lastSeenEventId:
                  replayCursor === undefined
                    ? this.getReconnectCursor(input)
                    : replayCursor,
              }
            : {}),
        };
        const single = this.config.transport === "single";
        const response = await requestFetch(
          single ? this.config.runtimeUrl : this.buildRuntimeUrl(mode),
          {
            method: "POST",
            redirect: "error",
            headers: {
              "Content-Type": "application/json",
              ...this.headers,
            },
            // Post the whole RunAgentInput rather than naming each field, so a
            // protocol field such as `resume` cannot be dropped here again.
            body: JSON.stringify(
              single
                ? {
                    method: `agent/${mode}`,
                    params: { agentId: this.config.agentId },
                    body,
                  }
                : body,
            ),
            ...(this.credentials ? { credentials: this.credentials } : {}),
          },
        );

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
      unopenedRefreshes?: number;
    },
  ): Observable<BaseEvent> {
    const { unopenedRefreshes: previousUnopened = 0, ...sessionOptions } =
      options;
    return defer(() => {
      let socketOpened = false;
      return this.observeThreadSession$(input, credentials, {
        ...sessionOptions,
        onSocketOpen: () => {
          socketOpened = true;
        },
      }).pipe(
        catchError((error) => {
          if (!this.isSocketReconnectExhaustedError(error)) {
            return throwError(() => error);
          }

          // A session whose socket opened was a real connection that dropped, so
          // it restarts the count. Sessions that never open mean the realtime
          // endpoint is unavailable, and fresh credentials will not fix that.
          // Only a run is capped: a developer is waiting on its turn. A connect
          // restores history in the background, and nothing retries it after it
          // fails, so it keeps reconnecting until the endpoint recovers.
          const unopenedRefreshes = socketOpened ? 0 : previousUnopened + 1;
          if (
            options.streamMode === "run" &&
            unopenedRefreshes > MAX_UNOPENED_CREDENTIAL_REFRESHES
          ) {
            return throwError(
              () =>
                new Error(
                  `Realtime connection to ${credentials.realtime.clientUrl} never opened ` +
                    `in ${unopenedRefreshes} connection attempts. ` +
                    `The realtime endpoint is unavailable.`,
                ),
            );
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
                    this.applyCanonicalRunIdentity(
                      input,
                      refreshedCredentials,
                      {
                        fallbackToInputRunId: options.streamMode === "run",
                      },
                    ),
                    refreshedCredentials,
                    {
                      ...sessionOptions,
                      channelMode: "connect",
                      replayCursor,
                      unopenedRefreshes,
                    },
                  ),
            ),
          );
        }),
      );
    });
  }

  private observeThreadSession$(
    input: RunAgentInput,
    credentials: ThreadJoinCredentials,
    options: {
      completeOnRunError: boolean;
      streamMode: "run" | "connect";
      channelMode?: "run" | "connect";
      replayCursor?: string | null;
      onSocketOpen?: () => void;
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
      const bounded =
        options.streamMode === "connect" &&
        this.config.replayProtocol === "bounded_v1";
      const channel$ = ɵphoenixChannel$({
        socket$,
        topic: bounded
          ? credentials.realtime.topic.replace(/^thread:/, "bounded_thread:")
          : credentials.realtime.topic,
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
      const threadEvents$ = (
        bounded
          ? this.observeBoundedThreadEvents$(input.threadId, channel$, () => {
              params.last_seen_event_id = this.getLastSeenEventId(
                input.threadId,
              );
            })
          : this.observeThreadEvents$(input.threadId, channel$, options)
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
        !bounded,
      ).pipe(shareReplay({ bufferSize: 1, refCount: true }));
      const streamIdle$ = this.observeControlEvent$(
        input.threadId,
        channel$,
        STREAM_IDLE_EVENT,
        !bounded,
      ).pipe(shareReplay({ bufferSize: 1, refCount: true }));
      const streamIdleCompletion$ =
        options.streamMode === "connect"
          ? merge(
              combineLatest([
                replayComplete$.pipe(take(1)),
                streamIdle$.pipe(take(1)),
              ]),
              bounded
                ? EMPTY
                : streamIdle$.pipe(
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
        this.observeSocketHealth$(socket$, options.onSocketOpen).pipe(
          takeUntil(terminal$),
        ),
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
    onSocketOpen?: () => void,
  ): Observable<never> {
    return ɵobservePhoenixSocketHealth$(
      ɵobservePhoenixSocketSignals$(socket$).pipe(
        tap((signal) => {
          if (signal.type === "open") onSocketOpen?.();
        }),
      ),
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

  /** Each channel restart gets a new replay session after the old application settles. */
  private observeBoundedThreadEvents$(
    threadId: string,
    channel$: Observable<ɵPhoenixChannelSession>,
    updateJoinCursor: () => void,
  ): Observable<BaseEvent> {
    return channel$.pipe(
      switchMapOperator(
        ({ channel }) =>
          new Observable<BaseEvent>((subscriber) => {
            const push = channel.push?.bind(channel);
            if (!push) {
              subscriber.error(
                new Error("Bounded replay requires channel acknowledgements"),
              );
              return;
            }
            const checkpoint = () => ({
              messages: structuredClone_(this.messages),
              state: structuredClone_(this.state),
              cursor: this.getLastSeenEventId(threadId),
            });
            const createSession = (ready: Promise<void>) => {
              const chunks = new Subject<BaseEvent>();
              const transformed = {
                events: [] as BaseEvent[],
                error: undefined as unknown,
              };
              const chunkSubscription = chunks
                .pipe(transformChunks(this.debugLogger))
                .subscribe({
                  next: (event) => transformed.events.push(event),
                  error: (error: unknown) => {
                    transformed.error = error;
                  },
                });
              return {
                chunks,
                transformed,
                chunkSubscription,
                active: true,
                ready,
                pending: null as Promise<void> | null,
                previous: null as ReturnType<typeof checkpoint> | null,
                restoreId: null as string | null,
                sequence: 0,
                committed: false,
                applying: false,
              };
            };
            let session = createSession(this.replaySettled);
            let retiredRestoreId: string | null = null;
            const cancel = (current: typeof session) => {
              current.active = false;
              current.chunkSubscription.unsubscribe();
              const rollback = () => {
                if (!current.previous) return;
                const previous = current.previous;
                current.previous = null;
                this.setMessages(previous.messages);
                this.setState(previous.state);
                if (previous.cursor === null)
                  this.sharedState.lastSeenEventIds.delete(threadId);
                else
                  this.sharedState.lastSeenEventIds.set(
                    threadId,
                    previous.cursor,
                  );
                updateJoinCursor();
              };
              if (!current.pending) rollback();
              const settled = (current.pending ?? current.ready).then(
                rollback,
                rollback,
              );
              this.replaySettled = settled;
              return settled;
            };
            const fail = (reason: string) => {
              cancel(session);
              subscriber.error(new Error(`Bounded replay failed: ${reason}`));
            };
            const enqueue = (events: BaseEvent[], finish: () => void) => {
              const current = session;
              const frame: BaseEvent = { type: EventType.CUSTOM };
              this.replayApplications.set(frame, (input, subscribers) => {
                const pending = (async () => {
                  await current.ready;
                  if (!current.active) return;
                  current.previous ??= checkpoint();
                  try {
                    for (const event of events) current.chunks.next(event);
                    if (current.transformed.error !== undefined)
                      throw current.transformed.error;
                    const transformed = current.transformed.events.splice(0);
                    await this.applyReplayFrame(
                      input,
                      transformed,
                      subscribers,
                      () => current.active,
                    );
                    if (current.active) finish();
                  } catch (error) {
                    if (current.active) throw error;
                  }
                })();
                current.pending = pending;
                return pending.finally(() => {
                  current.pending = null;
                });
              });
              subscriber.next(frame);
            };
            const envelope = (
              value: unknown,
            ): Record<string, unknown> | null => {
              if (!value || typeof value !== "object") return null;
              const row = value as Record<string, unknown>;
              if (
                typeof row.restore_id !== "string" ||
                typeof row.token !== "string" ||
                row.restore_id.length > 128 ||
                row.token.length > 128 ||
                (session.restoreId !== null &&
                  session.restoreId !== row.restore_id)
              )
                return null;
              session.restoreId = row.restore_id;
              return row;
            };
            const stale = (value: unknown) =>
              retiredRestoreId !== null &&
              !!value &&
              typeof value === "object" &&
              "restore_id" in value &&
              value.restore_id === retiredRestoreId;
            const isEvent = (value: unknown): value is BaseEvent =>
              !!value &&
              typeof value === "object" &&
              "type" in value &&
              typeof value.type === "string" &&
              new Set<string>(Object.values(EventType)).has(value.type);
            const batchRef = channel.on(
              "bounded_replay_batch",
              (value: unknown) => {
                if (stale(value)) return;
                const row = envelope(value);
                if (
                  !row ||
                  session.applying ||
                  row.sequence !== session.sequence + 1 ||
                  !Array.isArray(row.events) ||
                  row.events.length !== 1 ||
                  !row.events.every(isEvent) ||
                  row.phase !== (session.committed ? "live" : "history")
                ) {
                  fail("invalid batch");
                  return;
                }
                const current = session;
                const events: BaseEvent[] = row.events;
                current.applying = true;
                current.sequence += 1;
                enqueue(events, () => {
                  if (current.committed) {
                    for (const event of events)
                      this.updateLastSeenEventId(threadId, event);
                    current.previous = null;
                    updateJoinCursor();
                  }
                  current.applying = false;
                  push("bounded_replay_ack", {
                    restore_id: current.restoreId,
                    sequence: current.sequence,
                    token: row.token,
                  });
                });
              },
            );
            const commitRef = channel.on(
              "bounded_replay_commit",
              (value: unknown) => {
                if (stale(value)) return;
                const row = envelope(value);
                if (
                  !row ||
                  session.committed ||
                  session.applying ||
                  (row.latestEventId !== null &&
                    typeof row.latestEventId !== "string")
                ) {
                  fail("invalid commit");
                  return;
                }
                const current = session;
                current.applying = true;
                enqueue([], () => {
                  this.updateLastSeenEventIdFromControl(threadId, row);
                  current.previous = null;
                  current.committed = true;
                  current.applying = false;
                  updateJoinCursor();
                  push("bounded_replay_commit_ack", {
                    restore_id: current.restoreId,
                    token: row.token,
                  });
                });
              },
            );
            const errorRef = channel.onError?.(() => {
              if (subscriber.closed) return;
              retiredRestoreId = session.restoreId ?? retiredRestoreId;
              session = createSession(cancel(session));
            });
            const failureRef = channel.on("replay_failed", (value: unknown) => {
              if (!stale(value)) fail("server rejected restore or delivery");
            });
            return () => {
              channel.off("bounded_replay_batch", batchRef);
              channel.off("bounded_replay_commit", commitRef);
              channel.off("replay_failed", failureRef);
              if (typeof errorRef === "number")
                channel.off("phx_error", errorRef);
              cancel(session);
            };
          }),
      ),
    );
  }

  private observeControlEvent$(
    threadId: string,
    channel$: Observable<ɵPhoenixChannelSession>,
    eventName: string,
    updateCursor = true,
  ): Observable<unknown> {
    return channel$.pipe(
      switchMapOperator(({ channel }) =>
        this.observeChannelEvent$<unknown>(channel, eventName),
      ),
      tap((payload) => {
        if (updateCursor)
          this.updateLastSeenEventIdFromControl(threadId, payload);
      }),
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
          ...(this.config.replayProtocol
            ? { replay_protocol: this.config.replayProtocol }
            : {}),
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
