import type { ConnectionReplayLifecycle } from "./utils/connect-replay";
import type {
  RunAgentInput,
  RunAgentParameters,
  RunAgentResult,
  AgentSubscriber,
  BaseEvent,
} from "@ag-ui/client";
import { AbstractAgent, EventType } from "@ag-ui/client";

import {
  EMPTY,
  Notification,
  combineLatest,
  defer,
  dematerialize,
  merge,
  of,
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
  map,
  mergeMap,
  startWith,
  share,
  shareReplay,
  switchMap as switchMapOperator,
  take,
  takeUntil,
  tap,
} from "rxjs/operators";
import {
  phoenixExponentialBackoff,
  stripIntelligenceRoutingFields,
} from "@copilotkit/shared";
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
const REPLAY_FAILED_EVENT = "replay_failed";
const STREAM_IDLE_EVENT = "stream_idle";
const STOP_RUN_EVENT = "stop_run";
const CONNECT_STREAM_IDLE_REPLAY_FALLBACK_MS = 100;
const CONNECT_IDLE_WARNING_MS = 30_000;
// Credential refreshes allowed in a row for sockets that never opened. Past this,
// the run fails instead of waiting on a realtime endpoint that is not answering.
const MAX_UNOPENED_CREDENTIAL_REFRESHES = 2;

interface IntelligenceAgentSharedState {
  lastSeenEventIds: Map<string, string>;
  /**
   * Per thread, the run and `cpki_event_seq` of the event that last moved the
   * cursor. Keeps a replayed older event of the same run from moving it back.
   */
  lastSeenEventSeqs?: Map<string, EventSequencePosition>;
}

/** Where an event sits in its run: `cpki_event_seq` is ordered per run. */
interface EventSequencePosition {
  runId: string;
  seq: number;
}

/**
 * Cursor state for one thread session. It lives across same-socket rejoins
 * (phoenix.js rejoins after `phx_error` or a socket reconnect without a new
 * session), and is reset only when the pipeline builds a new session.
 */
interface ThreadSessionCursorState {
  /**
   * The newest durable cursor this session delivered or confirmed. A rejoin
   * resumes from it rather than re-sending the first join's params.
   */
  latest: string | null;
  /**
   * What this session already delivered. A replay after a rejoin that still
   * repeats an event is dropped before it can move the cursor or reach AG-UI
   * verification.
   */
  delivered: DeliveredEvents;
}

/**
 * Delivered events, kept small enough to hold for a whole long run.
 *
 * Numbered events are tracked per run as a contiguous range (every
 * `cpki_event_seq` from `from` through `through`) plus the few numbers
 * delivered above it, and any delivered below the first one seen. Events
 * normally arrive in order, so both sets stay empty and a run of tens of
 * thousands of events costs two numbers. Unnumbered durable events are rare
 * (the gateway's own RUN_ERROR, runs that predate numbering) and are
 * remembered by id, up to `MAX_DELIVERED_UNNUMBERED_IDS`.
 */
interface DeliveredEvents {
  runs: Map<
    string,
    { from: number; through: number; above: Set<number>; below: Set<number> }
  >;
  unnumberedIds: Set<string>;
}

const MAX_DELIVERED_UNNUMBERED_IDS = 1_024;

/** Control-frame cursor state for one channel join. */
interface ControlCursorState {
  /** The last `latestEventId` that this join saved as the reconnect cursor. */
  applied: string | null;
  /** True after `replay_failed`. The gateway then repeats the prior cursor on purpose. */
  replayFailed: boolean;
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

interface McpResourceReadResponse {
  kind: "mcp-resource-read";
  threadId: string;
  runId: string;
  result: unknown;
}

function isMcpResourceRead(input: RunAgentInput): boolean {
  const forwardedProps = input.forwardedProps as
    | Record<string, unknown>
    | undefined;
  const request = forwardedProps?.__proxiedMCPRequest;
  return (
    forwardedProps?.__copilotkitMcpResourceReadOnly === true &&
    typeof request === "object" &&
    request !== null &&
    (request as { method?: unknown }).method === "resources/read"
  );
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
  /** Optional headers sent with REST requests */
  headers?: Record<string, string>;
  /** Optional credentials mode for fetch requests */
  credentials?: RequestCredentials;
  fetch?: typeof fetch;
}

export class IntelligenceAgent extends AbstractAgent {
  private config: IntelligenceAgentConfig;
  private socket: Socket | null = null;
  private activeChannel: Channel | null = null;
  private canonicalRunId: string | null = null;
  /**
   * Counts the runs and connects this agent has started. A stop settles later
   * than it is sent, so it compares this to tell whether a newer run has taken
   * over the agent in the meantime.
   */
  private runGeneration = 0;
  private sharedState: IntelligenceAgentSharedState;

  constructor(
    config: IntelligenceAgentConfig,
    sharedState: IntelligenceAgentSharedState = {
      lastSeenEventIds: new Map<string, string>(),
      lastSeenEventSeqs: new Map<string, EventSequencePosition>(),
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
    // A run already in flight owns the canonical run id; reuse it so the
    // replay is attributed to that run rather than minting a new one.
    const effectiveParameters =
      parameters?.runId || !this.canonicalRunId
        ? parameters
        : {
            ...parameters,
            runId: this.canonicalRunId,
          };

    return ɵconnectWithoutEventVerification(
      this,
      effectiveParameters,
      subscriber,
      (input, lifecycle) => this.connect(input, lifecycle),
    );
  }

  abortRun(): void {
    const channel = this.activeChannel;
    const runId = this.canonicalRunId;
    if (!channel || !runId) {
      void this.detachActiveRun();
      this.cleanup();
      return;
    }

    // Defer cleanup until the push is acknowledged so socket.disconnect()
    // doesn't clear the push buffer before the stop signal is sent.
    // The 5-second fallback handles the case where the socket is down and
    // Phoenix never flushes the buffered push (its .receive("timeout") only
    // fires for pushes that were actually sent but not replied to).
    // detachActiveRun() gracefully tears down the connectAgent() pipeline;
    // cleanup() follows as a safety net for the run() path.
    //
    // The stop can settle up to 10 s from now, when a follow-up run may own
    // the agent, so what it tears down is captured here and clear() runs once.
    // Under ProxiedCopilotRuntimeAgent the gateway's reply never reaches this
    // push: the proxy detaches the run right after it, and Phoenix drops a
    // left channel from its socket at once. The fallback settles the stop,
    // and the push's own timeout fires again later.
    const socket = this.socket;
    const generation = this.runGeneration;
    let settled = false;
    const clear = () => {
      if (settled) return;
      settled = true;
      clearTimeout(fallback);
      if (this.runGeneration === generation) {
        // No run has started since the stop, so everything current is the
        // stopped run's.
        void this.detachActiveRun();
        this.cleanup();
      } else {
        this.cleanupOwned(channel, socket, runId);
      }
    };
    const fallback = setTimeout(clear, 5_000);

    channel
      .push(STOP_RUN_EVENT, { run_id: runId })
      .receive("ok", clear)
      .receive("error", clear)
      .receive("timeout", clear);
  }

  /**
   * Trigger the run via REST, then join the realtime thread channel and relay
   * server-pushed AG-UI events to the Observable subscriber.
   */
  run(input: RunAgentInput): Observable<BaseEvent> {
    if (!isMcpResourceRead(input)) {
      this.runGeneration += 1;
      this.threadId = input.threadId;
      this.canonicalRunId = input.runId;
    }

    return defer(() => this.requestJoinCredentials$("run", input)).pipe(
      switchMap((credentials) => {
        if (credentials === null) {
          return throwError(
            () => new Error("REST run request returned no credentials"),
          );
        }

        if ("kind" in credentials) {
          return of(
            {
              type: EventType.RUN_STARTED,
              threadId: credentials.threadId,
              runId: credentials.runId,
            } as BaseEvent,
            {
              type: EventType.RUN_FINISHED,
              threadId: credentials.threadId,
              runId: credentials.runId,
              result: credentials.result,
            } as BaseEvent,
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
  protected connect(
    input: RunAgentInput,
    lifecycle?: ConnectionReplayLifecycle,
  ): Observable<BaseEvent> {
    this.runGeneration += 1;
    this.threadId = input.threadId;
    this.canonicalRunId = null;
    const replayCursor = this.getReconnectCursor(input);

    return defer(() =>
      this.requestJoinCredentials$("connect", input, replayCursor),
    ).pipe(
      switchMap((credentials) => {
        if (credentials === null) {
          lifecycle?.onReplayStarted?.();
          lifecycle?.onReplayFinished?.();
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
          lifecycle,
        });
      }),
    );
  }

  /**
   * Tear down a specific channel + socket pair that belongs to one pipeline.
   * Only nulls instance references when they still point to the owned resource,
   * and the run ID only while it is still the owner's, so a concurrent
   * pipeline's resources are never clobbered.
   */
  private cleanupOwned(
    ownChannel: Channel | null,
    ownSocket: Socket | null,
    ownRunId: string | null,
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
    if (this.canonicalRunId === ownRunId) {
      this.canonicalRunId = null;
    }
  }

  private cleanup(): void {
    this.cleanupOwned(this.activeChannel, this.socket, this.canonicalRunId);
  }

  private requestJoinCredentials$(
    mode: "run",
    input: RunAgentInput,
  ): Observable<ThreadJoinCredentials | McpResourceReadResponse>;
  private requestJoinCredentials$(
    mode: "connect",
    input: RunAgentInput,
    replayCursor?: string | null,
  ): Observable<ThreadJoinCredentials | null>;
  private requestJoinCredentials$(
    mode: "run" | "connect",
    input: RunAgentInput,
    replayCursor?: string | null,
  ): Observable<ThreadJoinCredentials | McpResourceReadResponse | null> {
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

        const payload: unknown = await response.json();
        if (
          mode === "run" &&
          isMcpResourceRead(input) &&
          typeof payload === "object" &&
          payload !== null &&
          (payload as { kind?: unknown }).kind === "mcp-resource-read"
        ) {
          const resource = payload as Partial<McpResourceReadResponse>;
          if (
            typeof resource.threadId !== "string" ||
            !resource.threadId ||
            typeof resource.runId !== "string" ||
            !resource.runId
          ) {
            throw new Error("invalid MCP resource response identity");
          }
          return {
            kind: "mcp-resource-read" as const,
            threadId: resource.threadId,
            runId: resource.runId,
            result: resource.result,
          };
        }
        return this.normalizeJoinCredentials(payload, input);
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
      lifecycle?: ConnectionReplayLifecycle;
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
      lifecycle?: ConnectionReplayLifecycle;
      channelMode?: "run" | "connect";
      replayCursor?: string | null;
      onSocketOpen?: () => void;
    },
  ): Observable<BaseEvent> {
    return defer(() => {
      options.lifecycle?.onReplayStarted?.();
      // Capture references to the socket and channel created by THIS pipeline
      // so the finalize closure only tears down its own resources.  Without
      // this, a fire-and-forget detachActiveRun() from run-handler can race:
      // the old pipeline's deferred cleanup reads from `this.socket` /
      // `this.activeChannel`, which by then may already point to the NEW
      // pipeline's resources — destroying the live connection and preventing
      // the stop signal from ever reaching the backend.
      let ownSocket: Socket | null = null;
      let ownChannel: Channel | null = null;
      // The canonical run ID this pipeline joined under, set just before it.
      const ownRunId = this.canonicalRunId;

      // Silence after replay may mean a long-running agent or an unavailable
      // thread-lock lookup. Diagnose it without declaring an active run idle.
      let replayFinished = false;
      let warnedAboutIdle = false;
      let idleWarning: ReturnType<typeof setTimeout> | undefined;
      const clearIdleWarning = () => {
        clearTimeout(idleWarning);
        idleWarning = undefined;
      };
      const scheduleIdleWarning = () => {
        clearIdleWarning();
        if (
          options.streamMode !== "connect" ||
          !replayFinished ||
          warnedAboutIdle
        )
          return;
        idleWarning = setTimeout(() => {
          warnedAboutIdle = true;
          this.debugLogger?.lifecycle(
            "INTELLIGENCE",
            "No progress or stream_idle for 30 seconds after replay_complete; the run may still be active or its status unavailable.",
            { threadId: input.threadId },
          );
        }, CONNECT_IDLE_WARNING_MS);
      };

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
      const sessionCursor: ThreadSessionCursorState = {
        latest: null,
        delivered: { runs: new Map(), unnumberedIds: new Set<string>() },
      };
      let reconnectCursor = this.readDurableEventId(
        options.replayCursor ?? this.getReconnectCursor(input),
      );
      const initialParams = this.createThreadChannelParams(
        input,
        options.channelMode ?? options.streamMode,
        options.replayCursor,
      );
      // phoenix.js calls this on the first join and again on every rejoin of
      // the same channel (after `phx_error`, or after the socket reconnects on
      // its own). Re-sending the first join's params would ask the gateway to
      // replay from where this session started: a run stream would get its
      // RUN_STARTED again and fail AG-UI verification, and the replayed events
      // would move the cursor back. Once this session holds a durable cursor,
      // a rejoin resumes from it in connect mode, as the credential-refresh
      // path does. Run mode cannot resume: the gateway ignores
      // `last_seen_event_id` there and always replays the run from its start.
      // Client-side run semantics follow `options.streamMode`, not the channel
      // mode, so run completion, run errors and stop are unchanged.
      const params = () => {
        if (sessionCursor.latest === null) return initialParams;
        reconnectCursor = sessionCursor.latest;
        return this.createThreadChannelParams(
          input,
          "connect",
          sessionCursor.latest,
        );
      };
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
      let latestObservedReplayCursor: string | null = null;
      const threadEvents$ = this.observeThreadEvents$(
        input.threadId,
        channel$,
        options,
        sessionCursor,
      ).pipe(
        tap((payload) => {
          latestObservedReplayCursor =
            this.readEventId(payload) ?? latestObservedReplayCursor;
          scheduleIdleWarning();
        }),
        share(),
      );
      const controlCursor: ControlCursorState = {
        applied: null,
        replayFailed: false,
      };
      const replayFailed$ = channel$.pipe(
        switchMapOperator(({ channel }) =>
          this.observeChannelEvent$<unknown>(channel, REPLAY_FAILED_EVENT),
        ),
        tap(() => {
          controlCursor.replayFailed = true;
        }),
      );
      // Controls are scoped to each replay epoch, not cached across rejoin.
      const replayComplete$ = this.observeControlEvent$(
        input.threadId,
        channel$,
        REPLAY_COMPLETE_EVENT,
        controlCursor,
        sessionCursor,
      ).pipe(
        // Notify before idle completion can unsubscribe other observers.
        tap(() => {
          replayFinished = true;
          scheduleIdleWarning();
          options.lifecycle?.onReplayFinished?.();
        }),
        share(),
      );
      const streamIdle$ = this.observeControlEvent$(
        input.threadId,
        channel$,
        STREAM_IDLE_EVENT,
        controlCursor,
        sessionCursor,
      ).pipe(share());
      const replayRestart$ = merge(
        this.observeControlEvent$(
          input.threadId,
          channel$,
          "phx_error",
          controlCursor,
          sessionCursor,
        ),
        ɵobservePhoenixSocketSignals$(socket$).pipe(
          filter((signal) => signal.type === "error"),
        ),
      ).pipe(
        tap(() => {
          replayFinished = false;
          warnedAboutIdle = false;
          clearIdleWarning();
          options.lifecycle?.onReplayStarted?.();
        }),
        share(),
      );
      const streamIdleCompletion$ =
        options.streamMode === "connect"
          ? replayRestart$.pipe(
              startWith(null),
              switchMap(() =>
                merge(
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
                    tap(() => {
                      this.debugLogger?.lifecycle(
                        "INTELLIGENCE",
                        "Completing connection on stream_idle fallback without replay_complete.",
                        {
                          threadId: input.threadId,
                          fallbackMs: CONNECT_STREAM_IDLE_REPLAY_FALLBACK_MS,
                        },
                      );
                    }),
                  ),
                ),
              ),
              take(1),
              shareReplay({ bufferSize: 1, refCount: true }),
            )
          : EMPTY;
      const threadCompleted$ = threadEvents$.pipe(
        ignoreElements(),
        endWith(null),
        take(1),
      );
      const terminal$ = merge(threadCompleted$, streamIdleCompletion$);

      return merge(
        // Install replay/idle observers before joining the channel.
        replayFailed$.pipe(ignoreElements(), takeUntil(terminal$)),
        replayComplete$.pipe(ignoreElements(), takeUntil(terminal$)),
        this.joinThreadChannel$(channel$),
        this.observeSocketHealth$(socket$, options.onSocketOpen).pipe(
          takeUntil(terminal$),
        ),
        threadEvents$.pipe(takeUntil(streamIdleCompletion$)),
        streamIdleCompletion$.pipe(
          ignoreElements(),
          takeUntil(threadCompleted$),
        ),
      ).pipe(
        finalize(() => {
          clearIdleWarning();
          this.cleanupOwned(ownChannel, ownSocket, ownRunId);
        }),
      );
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
    sessionCursor: ThreadSessionCursorState,
  ): Observable<BaseEvent> {
    return channel$.pipe(
      switchMapOperator(({ channel }) =>
        this.observeChannelEvent$<BaseEvent>(channel, CLIENT_AG_UI_EVENT),
      ),
      // A durable event this session already delivered is a replay, for
      // example from a gateway that replays after a rejoin. Delivering it again
      // would duplicate content or fail verification (a second RUN_STARTED).
      filter((payload) => {
        const eventId = this.readEventId(payload);
        if (eventId === null) return true;
        if (this.markDelivered(sessionCursor.delivered, eventId, payload)) {
          return true;
        }
        this.debugLogger?.lifecycle(
          "INTELLIGENCE",
          "Dropping a replayed event this connection already delivered.",
          { threadId, eventId, type: payload.type },
        );
        return false;
      }),
      tap((payload) => {
        if (this.updateLastSeenEventId(threadId, payload)) {
          sessionCursor.latest = this.readEventId(payload);
        }
      }),
      // Only the run stream goes through AG-UI 1.0 enforcement, which would
      // strip these fields with a warning each. Replays stay as sent.
      map((payload) =>
        options.streamMode === "run"
          ? stripIntelligenceRoutingFields(payload)
          : payload,
      ),
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
    controlCursor: ControlCursorState,
    sessionCursor: ThreadSessionCursorState,
  ): Observable<unknown> {
    return channel$.pipe(
      switchMapOperator(({ channel }) =>
        this.observeChannelEvent$<unknown>(channel, eventName),
      ),
      tap((payload) => {
        const applied = this.updateLastSeenEventIdFromControl(
          threadId,
          payload,
          controlCursor,
        );
        if (applied !== null) sessionCursor.latest = applied;
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
    this.sharedState.lastSeenEventSeqs?.delete(threadId);
  }

  /**
   * Move the thread's cursor to `payload`'s durable event id. Returns whether
   * it moved.
   *
   * The cursor never moves back within a run: an event whose `cpki_event_seq`
   * is at or below the one already recorded for the same run is a replay, and
   * is ignored. `cpki_event_seq` is ordered per run only, so an event of
   * another run, or one without a run id or sequence, cannot be compared and
   * moves the cursor as before (the gateway delivers thread history in order).
   */
  private updateLastSeenEventId(threadId: string, payload: BaseEvent): boolean {
    const eventId = this.readEventId(payload);
    if (!eventId) {
      return false;
    }

    const position = this.readEventSequencePosition(payload);
    const seqs = this.sharedState.lastSeenEventSeqs;
    const previous = seqs?.get(threadId);
    if (
      position &&
      previous &&
      position.runId === previous.runId &&
      position.seq <= previous.seq
    ) {
      return false;
    }

    this.advanceLastSeenEventId(threadId, eventId);
    if (position) {
      seqs?.set(threadId, position);
    } else {
      seqs?.delete(threadId);
    }
    return true;
  }

  private updateLastSeenEventIdFromControl(
    threadId: string,
    payload: unknown,
    controlCursor: ControlCursorState,
  ): string | null {
    const eventId = this.readControlEventId(payload);
    if (!eventId) {
      return null;
    }

    // An older gateway repeats the join's history checkpoint on every control
    // frame, also on stream_idle after live events moved past it. A repeat is
    // stale and must not replace the newer event cursor, or the next join
    // replays those live events again. After replay_failed the gateway repeats
    // the prior cursor on purpose, so the next join retries the failed history.
    if (eventId === controlCursor.applied && !controlCursor.replayFailed) {
      return null;
    }

    controlCursor.applied = eventId;
    this.advanceLastSeenEventId(threadId, eventId);
    return eventId;
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

  /**
   * Record `payload` as delivered. Returns false if this session already
   * delivered it, true if it is new.
   */
  private markDelivered(
    delivered: DeliveredEvents,
    eventId: string,
    payload: BaseEvent,
  ): boolean {
    const position = this.readEventSequencePosition(payload);
    if (position === null) {
      if (delivered.unnumberedIds.has(eventId)) return false;
      if (delivered.unnumberedIds.size >= MAX_DELIVERED_UNNUMBERED_IDS) {
        const oldest = delivered.unnumberedIds.values().next().value;
        if (oldest !== undefined) delivered.unnumberedIds.delete(oldest);
      }
      delivered.unnumberedIds.add(eventId);
      return true;
    }

    let run = delivered.runs.get(position.runId);
    if (!run) {
      // A session can join mid-run, so the prefix starts at the first event it
      // sees rather than at 1.
      run = {
        from: position.seq,
        through: position.seq - 1,
        above: new Set<number>(),
        below: new Set<number>(),
      };
      delivered.runs.set(position.runId, run);
    }
    if (position.seq < run.from) {
      // Older than anything this session saw first: new unless seen here.
      if (run.below.has(position.seq)) return false;
      run.below.add(position.seq);
      return true;
    }
    if (position.seq <= run.through || run.above.has(position.seq)) {
      return false;
    }
    run.above.add(position.seq);
    while (run.above.delete(run.through + 1)) {
      run.through += 1;
    }
    return true;
  }

  private readEventSequencePosition(
    payload: BaseEvent,
  ): EventSequencePosition | null {
    const event = payload as BaseEvent & {
      metadata?: unknown;
      run_id?: unknown;
      runId?: unknown;
    };
    const runId = event.run_id ?? event.runId;
    const metadata = event.metadata;
    const seq =
      metadata && typeof metadata === "object"
        ? (metadata as { cpki_event_seq?: unknown }).cpki_event_seq
        : undefined;
    if (
      typeof runId !== "string" ||
      runId === "" ||
      typeof seq !== "number" ||
      !Number.isFinite(seq)
    ) {
      return null;
    }

    return { runId, seq };
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
