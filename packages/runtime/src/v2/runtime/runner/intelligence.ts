import type {
  AgentRunnerConnectRequest,
  AgentRunnerIsRunningRequest,
  AgentRunnerRunRequest,
} from "./agent-runner";
import { AgentRunner } from "./agent-runner";
import type { AgentRunnerStopRequest } from "./agent-runner";
import { Observable } from "rxjs";
import type { AbstractAgent, BaseEvent, RunStartedEvent } from "@ag-ui/client";
import { EventType } from "@ag-ui/client";
import {
  finalizeRunEvents,
  AG_UI_CHANNEL_EVENT,
  phoenixExponentialBackoff,
} from "@copilotkit/shared";
import type { Channel } from "phoenix";
import { Socket } from "phoenix";
import { randomUUID } from "node:crypto";

export interface IntelligenceAgentRunnerOptions {
  /** Phoenix runner websocket URL, e.g. "ws://localhost:4000/runner" */
  url: string;
  /** Optional Phoenix socket auth token used during websocket connect. */
  authToken?: string;
  /** Max delay (ms) for WebSocket reconnect backoff. @default 10_000 */
  maxReconnectMs?: number;
  /** Max delay (ms) for channel rejoin backoff. @default 30_000 */
  maxRejoinMs?: number;
}

export interface RunnerStartupBoundary {
  events: Observable<BaseEvent>;
  startup: Promise<void>;
}

interface ThreadState {
  threadId: string;
  runId: string;
  socket: Socket;
  channel: Channel;
  isRunning: boolean;
  stopRequested: boolean;
  agent: AbstractAgent | null;
  currentEvents: BaseEvent[];
  nextEventSeq: number;
  hasRunStarted: boolean;
  hasJoined: boolean;
  supportsRunnerEventBatch: boolean;
  producerFinished: boolean;
  pendingEvents: Map<
    string,
    { payload: Record<string, unknown>; queuedAt: number }
  >;
  activeEventBatch: { eventIds: string[]; attempt: number } | null;
  nextEventPushAttempt: number;
  eventRetryTimer: ReturnType<typeof setTimeout> | null;
  eventFlushTimer: ReturnType<typeof setTimeout> | null;
  eventDeadlineTimer: ReturnType<typeof setTimeout> | null;
  socketReconnectWatchdog: ReturnType<typeof setTimeout> | null;
  eventRetryAttempt: number;
  completeRun: () => void;
  failRun: (error: Error) => void;
}

const MAX_CONSECUTIVE_SOCKET_ERRORS = 5;
const EVENT_RETRY_BASE_MS = 100;
const EVENT_RETRY_MAX_MS = 2_000;
const RUNNER_EVENT_BATCH_CAPABILITY = "runner_event_batch_v1";
const MAX_RUNNER_EVENT_BATCH_SIZE = 32;
const RUNNER_EVENT_BATCH_FLUSH_MS = 5;
const EVENT_DURABILITY_DEADLINE_MS = 60_000;

export class IntelligenceAgentRunner extends AgentRunner {
  private options: IntelligenceAgentRunnerOptions;
  private threads = new Map<string, ThreadState>();

  constructor(options: IntelligenceAgentRunnerOptions) {
    super();
    // Store config — sockets are created per-run, not eagerly.
    this.options = options;
  }

  /**
   * Create a new Phoenix socket with explicit exponential backoff.
   *
   * Each run/connect gets its own socket so that:
   *  - A socket failure only affects a single thread, not all threads.
   *  - Cleanup is simple: channel.leave() + socket.disconnect() tears
   *    down everything for that run with no shared-state concerns.
   *  - Each run gets its own independent retry budget.
   *
   * reconnectAfterMs — delay before Phoenix reconnects the WebSocket
   *   after an unclean close. 100ms base, doubling up to maxReconnectMs (default 10s).
   *
   * rejoinAfterMs — delay before Phoenix re-joins a channel that
   *   entered the "errored" state. 1s base, doubling up to maxRejoinMs (default 30s).
   *
   * These are set explicitly because Phoenix's default schedule is a
   * fixed stepped array (not exponential), and any code that calls
   * socket.disconnect() in an onError handler will set
   * closeWasClean = true and reset the reconnect timer — permanently
   * killing retries.
   */
  private createSocket(authToken = this.options.authToken): Socket {
    const socket = new Socket(this.options.url, {
      ...(authToken ? { authToken } : {}),
      reconnectAfterMs: phoenixExponentialBackoff(
        100,
        this.options.maxReconnectMs ?? 10_000,
      ),
      rejoinAfterMs: phoenixExponentialBackoff(
        1_000,
        this.options.maxRejoinMs ?? 30_000,
      ),
    });
    socket.connect();
    return socket;
  }

  private createRunnerEventPayload(
    event: BaseEvent,
    request: AgentRunnerRunRequest,
    state: ThreadState,
  ): Record<string, unknown> {
    const canonicalEvent = this.stampRunnerMetadata(
      this.stampCanonicalRunOwnership(event, request),
      state,
    );
    const payload = {
      ...(canonicalEvent as Record<string, unknown>),
    };

    payload.threadId = request.threadId;
    payload.runId = request.input.runId;
    payload.thread_id = request.threadId;
    payload.run_id = request.input.runId;

    return payload;
  }

  private stampCanonicalRunOwnership(
    event: BaseEvent,
    request: AgentRunnerRunRequest,
  ): BaseEvent {
    const eventRecord = event as BaseEvent & Record<string, unknown>;
    eventRecord.threadId = request.threadId;
    eventRecord.runId = request.input.runId;
    return eventRecord;
  }

  private stampRunnerMetadata(event: BaseEvent, state: ThreadState): BaseEvent {
    const eventRecord = event as BaseEvent & {
      metadata?: Record<string, unknown>;
    };

    const existingMetadata = eventRecord.metadata ?? {};
    const hasEventId = typeof existingMetadata.cpki_event_id === "string";
    const hasEventSeq = typeof existingMetadata.cpki_event_seq === "number";

    if (hasEventId && hasEventSeq) {
      const eventSeq = existingMetadata.cpki_event_seq as number;
      state.nextEventSeq = Math.max(state.nextEventSeq, eventSeq + 1);
      return eventRecord;
    }

    const eventSeq = state.nextEventSeq++;

    eventRecord.metadata = {
      ...existingMetadata,
      cpki_event_id:
        typeof existingMetadata.cpki_event_id === "string"
          ? existingMetadata.cpki_event_id
          : randomUUID(),
      cpki_event_seq: eventSeq,
    };
    return eventRecord;
  }

  run(request: AgentRunnerRunRequest): Observable<BaseEvent> {
    return this.createRunObservable(request);
  }

  runWithStartupBoundary(
    request: AgentRunnerRunRequest,
  ): RunnerStartupBoundary {
    let resolveStartup: (() => void) | undefined;
    let rejectStartup: ((reason: Error) => void) | undefined;
    const startup = new Promise<void>((resolve, reject) => {
      resolveStartup = resolve;
      rejectStartup = reject;
    });

    return {
      events: this.createRunObservable(request, {
        resolveStartup: () => resolveStartup?.(),
        rejectStartup: (error) => rejectStartup?.(error),
      }),
      startup,
    };
  }

  private createRunObservable(
    request: AgentRunnerRunRequest,
    startupBoundary?: {
      resolveStartup: () => void;
      rejectStartup: (error: Error) => void;
    },
  ): Observable<BaseEvent> {
    const { threadId, agent, input } = request;

    const existing = this.threads.get(threadId);
    if (existing?.isRunning) {
      throw new Error("Thread already running");
    }

    return new Observable((observer) => {
      if (this.threads.get(threadId)?.isRunning) {
        observer.error(new Error("Thread already running"));
        return;
      }

      const socket = this.createSocket(request.authToken);

      const channel = socket.channel(`ingestion:${input.runId}`, {
        thread_id: threadId,
        run_id: input.runId,
      });

      const state: ThreadState = {
        threadId,
        runId: input.runId,
        socket,
        channel,
        isRunning: true,
        stopRequested: false,
        agent,
        currentEvents: [],
        nextEventSeq: 1,
        hasRunStarted: false,
        hasJoined: false,
        supportsRunnerEventBatch: false,
        producerFinished: false,
        pendingEvents: new Map(),
        activeEventBatch: null,
        nextEventPushAttempt: 0,
        eventRetryTimer: null,
        eventFlushTimer: null,
        eventDeadlineTimer: null,
        socketReconnectWatchdog: null,
        eventRetryAttempt: 0,
        completeRun: () => observer.complete(),
        failRun: (error) => observer.error(error),
      };
      this.threads.set(threadId, state);

      let consecutiveSocketErrors = 0;
      let plannedRestart = false;

      socket.onClose((event) => {
        if (!this.isCurrentThreadState(threadId, state)) {
          return;
        }
        plannedRestart = plannedRestart || event?.code === 1012;
        if (event?.code !== 1000 && state.socketReconnectWatchdog === null) {
          state.socketReconnectWatchdog = setTimeout(() => {
            state.socketReconnectWatchdog = null;
            if (!state.isRunning || socket.isConnected()) {
              return;
            }
            socket.disconnect(() => {
              if (state.isRunning && !socket.isConnected()) {
                socket.connect();
              }
            });
          }, 1_000);
        }
      });
      socket.onOpen(() => {
        if (!this.isCurrentThreadState(threadId, state)) {
          return;
        }
        if (state.socketReconnectWatchdog !== null) {
          clearTimeout(state.socketReconnectWatchdog);
          state.socketReconnectWatchdog = null;
        }
        consecutiveSocketErrors = 0;
        plannedRestart = false;
      });
      socket.onError(() => {
        if (!this.isCurrentThreadState(threadId, state)) {
          return;
        }
        // Once the gateway has accepted the run, transport recovery is not a
        // terminal condition. The agent may still be producing the
        // authoritative answer while Phoenix reconnects and replays durable
        // events, so an arbitrary socket-error count must not abort it.
        if (plannedRestart || state.hasJoined) {
          return;
        }

        consecutiveSocketErrors += 1;
        if (consecutiveSocketErrors >= MAX_CONSECUTIVE_SOCKET_ERRORS) {
          state.agent?.abortRun();
        }
      });

      // Listen for custom "stop" events pushed by the client over the
      // channel. This must be registered before channel.join() so the
      // handler is in place by the time the server starts relaying messages.
      // The client sends the stop event before leaving the channel, so the
      // runner is guaranteed to receive it while still joined.
      channel.on(AG_UI_CHANNEL_EVENT, (payload: BaseEvent) => {
        if (
          payload.type === EventType.CUSTOM &&
          (payload as BaseEvent & { name?: string }).name === "stop"
        ) {
          this.stop({ threadId });
        }
      });

      channel
        .join()
        .receive("ok", (response) => {
          if (!this.isCurrentThreadState(threadId, state)) {
            return;
          }
          const supportsRunnerEventBatch =
            this.supportsRunnerEventBatch(response);
          const activeEventBatch =
            state.supportsRunnerEventBatch === supportsRunnerEventBatch
              ? state.activeEventBatch
              : null;
          state.supportsRunnerEventBatch = supportsRunnerEventBatch;
          if (state.hasJoined) {
            this.resetPendingEventRetry(state);
            if (activeEventBatch !== null) {
              state.activeEventBatch = activeEventBatch;
              this.retryActiveEventBatch(state);
            } else {
              this.replayPendingEvents(state);
            }
            return;
          }

          state.hasJoined = true;
          startupBoundary?.resolveStartup();
          void this.executeAgentRun(request, state, threadId, (event) => {
            observer.next(event);
          });
        })
        .receive("error", (resp) => {
          if (!this.isCurrentThreadState(threadId, state)) {
            return;
          }
          if (state.hasJoined || this.isRetryableJoinError(resp)) {
            return;
          }

          const error = new Error(
            `Failed to join channel: ${JSON.stringify(resp)}`,
          );
          const errorEvent = {
            type: EventType.RUN_ERROR,
            message: error.message,
            code: "CHANNEL_JOIN_ERROR",
          } as BaseEvent;
          observer.next(errorEvent);
          state.currentEvents.push(errorEvent);
          this.removeThread(threadId, state);
          startupBoundary?.rejectStartup(error);
          observer.complete();
        })
        .receive("timeout", () => {
          if (!this.isCurrentThreadState(threadId, state)) {
            return;
          }
          if (state.hasJoined) {
            return;
          }

          const error = new Error("Timed out joining channel");
          const errorEvent = {
            type: EventType.RUN_ERROR,
            message: error.message,
            code: "CHANNEL_JOIN_TIMEOUT",
          } as BaseEvent;
          observer.next(errorEvent);
          state.currentEvents.push(errorEvent);
          this.removeThread(threadId, state);
          startupBoundary?.rejectStartup(error);
          observer.complete();
        });

      return () => {
        this.removeThread(threadId, state);
      };
    });
  }

  connect(request: AgentRunnerConnectRequest): Observable<BaseEvent> {
    const { threadId } = request;

    return new Observable((observer) => {
      const socket = this.createSocket();

      const channel = socket.channel(`thread:${threadId}`);

      channel.on("ag_ui_event", (payload: BaseEvent) => {
        observer.next(payload);

        if (
          payload.type === EventType.RUN_FINISHED ||
          payload.type === EventType.RUN_ERROR
        ) {
          observer.complete();
        }
      });

      const cleanup = () => {
        channel.leave();
        socket.disconnect();
      };

      channel
        .join()
        .receive("ok", () => undefined)
        .receive("error", (resp) => {
          observer.error(
            new Error(`Failed to join channel: ${JSON.stringify(resp)}`),
          );
          cleanup();
        })
        .receive("timeout", () => {
          observer.error(new Error("Timed out joining channel"));
          cleanup();
        });

      return () => {
        cleanup();
      };
    });
  }

  isRunning(request: AgentRunnerIsRunningRequest): Promise<boolean> {
    const state = this.threads.get(request.threadId);
    return Promise.resolve(state?.isRunning ?? false);
  }

  stop(request: AgentRunnerStopRequest): Promise<boolean | undefined> {
    const state = this.threads.get(request.threadId);
    if (!state || !state.isRunning || state.stopRequested) {
      return Promise.resolve(false);
    }
    if (request.runId !== undefined && state.runId !== request.runId) {
      return Promise.resolve(false);
    }

    state.stopRequested = true;

    // Direct local abort — the runtime is the authority.
    if (state.agent) {
      try {
        state.agent.abortRun();
      } catch {
        // Ignore abort errors.
      }
    }

    return Promise.resolve(true);
  }

  private async executeAgentRun(
    request: AgentRunnerRunRequest,
    state: ThreadState,
    threadId: string,
    onRunError: (event: BaseEvent) => void,
  ): Promise<void> {
    const { currentEvents } = state;
    const pushCanonicalEvent = (event: BaseEvent): void => {
      if (!this.isCurrentThreadState(threadId, state)) {
        return;
      }
      const canonicalEvent = this.stampRunnerMetadata(
        this.stampCanonicalRunOwnership(event, request),
        state,
      );
      currentEvents.push(canonicalEvent);

      if (canonicalEvent.type === EventType.RUN_STARTED) {
        state.hasRunStarted = true;
      }

      this.queueRunnerEvent(
        this.createRunnerEventPayload(canonicalEvent, request, state),
        state,
      );
    };

    const getPersistedInputMessages = () =>
      request.persistedInputMessages ?? request.input.messages;

    const buildRunStartedEvent = (
      source?: RunStartedEvent,
    ): RunStartedEvent => {
      const baseInput = source?.input ?? request.input;
      const persistedInputMessages = getPersistedInputMessages();
      const event =
        source ??
        ({
          type: EventType.RUN_STARTED,
          threadId: request.threadId,
          runId: request.input.runId,
        } as RunStartedEvent);
      event.threadId = request.threadId;
      event.runId = request.input.runId;
      event.input = {
        ...baseInput,
        threadId: request.threadId,
        runId: request.input.runId,
        ...(persistedInputMessages !== undefined
          ? { messages: persistedInputMessages }
          : {}),
      };
      return event;
    };

    const ensureRunStarted = (): void => {
      if (!state.hasRunStarted) {
        state.hasRunStarted = true;
        pushCanonicalEvent(buildRunStartedEvent());
      }
    };

    try {
      await request.agent.runAgent(request.input, {
        onEvent: ({ event }: { event: BaseEvent }) => {
          if (event.type === EventType.RUN_STARTED) {
            pushCanonicalEvent(buildRunStartedEvent(event as RunStartedEvent));
            return;
          }

          ensureRunStarted();
          pushCanonicalEvent(event);
        },
      });
    } catch (error) {
      if (!this.isCurrentThreadState(threadId, state)) {
        return;
      }
      ensureRunStarted();
      const existingError = currentEvents.find(
        (event) => event.type === EventType.RUN_ERROR,
      );
      if (existingError) {
        onRunError(existingError);
      } else {
        const errorEvent = {
          type: EventType.RUN_ERROR,
          message: error instanceof Error ? error.message : String(error),
        } as BaseEvent;
        pushCanonicalEvent(errorEvent);
        onRunError(errorEvent);
      }
    } finally {
      if (!this.isCurrentThreadState(threadId, state)) {
        return;
      }
      ensureRunStarted();
      const appended = finalizeRunEvents(currentEvents, {
        stopRequested: state.stopRequested,
      });
      for (const event of appended) {
        const canonicalEvent = this.stampRunnerMetadata(
          this.stampCanonicalRunOwnership(event, request),
          state,
        );
        this.queueRunnerEvent(
          this.createRunnerEventPayload(canonicalEvent, request, state),
          state,
        );
      }
      state.producerFinished = true;
      this.completeWhenDurable(threadId, state);
    }
  }

  /** Queue one immutable event payload until Redis-backed gateway acknowledgement. */
  private queueRunnerEvent(
    payload: Record<string, unknown>,
    state: ThreadState,
  ): void {
    if (!this.isCurrentThreadState(state.threadId, state)) {
      return;
    }
    const eventId = this.runnerEventId(payload);
    if (!state.pendingEvents.has(eventId)) {
      state.pendingEvents.set(eventId, { payload, queuedAt: Date.now() });
    }
    this.scheduleEventDeadline(state);
    this.replayPendingEvents(state);
  }

  private pushPendingEventBatch(
    eventIds: string[],
    events: Array<{ payload: Record<string, unknown>; queuedAt: number }>,
    state: ThreadState,
  ): void {
    if (
      !this.isCurrentThreadState(state.threadId, state) ||
      this.failIfEventDeadlineExceeded(state) ||
      state.channel.state !== "joined" ||
      !state.socket.isConnected()
    ) {
      return;
    }

    const attempt = ++state.nextEventPushAttempt;
    state.activeEventBatch = { eventIds, attempt };
    const payloads = events.map((event) => event.payload);
    const isBatch = state.supportsRunnerEventBatch;

    state.channel
      .push(
        isBatch ? "events" : "event",
        isBatch ? { events: payloads } : payloads[0],
      )
      .receive("ok", () => {
        if (
          !this.isCurrentThreadState(state.threadId, state) ||
          state.activeEventBatch?.attempt !== attempt
        ) {
          return;
        }
        if (this.failIfEventDeadlineExceeded(state)) {
          return;
        }
        for (const eventId of eventIds) {
          state.pendingEvents.delete(eventId);
        }
        state.activeEventBatch = null;
        state.eventRetryAttempt = 0;
        if (state.pendingEvents.size === 0) {
          this.clearPendingEventRetry(state);
          this.clearPendingEventFlush(state);
        }
        this.scheduleEventDeadline(state);
        this.completeWhenDurable(state.threadId, state);
        this.replayPendingEvents(state);
      })
      .receive("error", (response) =>
        this.handlePendingEventFailure(state, attempt, response),
      )
      .receive("timeout", () => this.handlePendingEventFailure(state, attempt));
  }

  private handlePendingEventFailure(
    state: ThreadState,
    attempt: number,
    response?: unknown,
  ): void {
    if (
      !this.isCurrentThreadState(state.threadId, state) ||
      state.activeEventBatch?.attempt !== attempt
    ) {
      return;
    }

    if (this.failIfEventDeadlineExceeded(state)) {
      return;
    }
    if (this.isPermanentEventFailure(response)) {
      this.failThread(
        state.threadId,
        state,
        new Error("Gateway permanently rejected queued runner events"),
      );
      return;
    }
    this.schedulePendingEventRetry(state);
  }

  private schedulePendingEventRetry(state: ThreadState): void {
    if (
      !this.isCurrentThreadState(state.threadId, state) ||
      state.pendingEvents.size === 0 ||
      state.eventRetryTimer !== null
    ) {
      return;
    }

    const delay = Math.min(
      EVENT_RETRY_BASE_MS * 2 ** state.eventRetryAttempt,
      EVENT_RETRY_MAX_MS,
    );
    state.eventRetryAttempt += 1;
    state.eventRetryTimer = setTimeout(() => {
      state.eventRetryTimer = null;
      if (
        !this.isCurrentThreadState(state.threadId, state) ||
        state.pendingEvents.size === 0
      ) {
        return;
      }
      this.retryActiveEventBatch(state);
    }, delay);
  }

  private clearPendingEventRetry(state: ThreadState): void {
    if (state.eventRetryTimer !== null) {
      clearTimeout(state.eventRetryTimer);
      state.eventRetryTimer = null;
    }
  }

  private schedulePendingEventFlush(state: ThreadState): void {
    if (
      !this.isCurrentThreadState(state.threadId, state) ||
      state.pendingEvents.size === 0 ||
      state.activeEventBatch !== null ||
      state.eventFlushTimer !== null
    ) {
      return;
    }

    const oldestQueuedAt = Math.min(
      ...[...state.pendingEvents.values()].map((event) => event.queuedAt),
    );
    const delay = Math.max(
      0,
      oldestQueuedAt + RUNNER_EVENT_BATCH_FLUSH_MS - Date.now(),
    );
    state.eventFlushTimer = setTimeout(() => {
      state.eventFlushTimer = null;
      if (!this.isCurrentThreadState(state.threadId, state)) {
        return;
      }
      this.flushPendingEventBatch(state);
    }, delay);
  }

  private clearPendingEventFlush(state: ThreadState): void {
    if (state.eventFlushTimer !== null) {
      clearTimeout(state.eventFlushTimer);
      state.eventFlushTimer = null;
    }
  }

  private resetPendingEventRetry(state: ThreadState): void {
    this.clearPendingEventRetry(state);
    this.clearPendingEventFlush(state);
    state.eventRetryAttempt = 0;
    state.activeEventBatch = null;
  }

  private replayPendingEvents(state: ThreadState): void {
    if (
      !this.isCurrentThreadState(state.threadId, state) ||
      state.activeEventBatch !== null
    ) {
      return;
    }

    const pendingEvents = [...state.pendingEvents.entries()].sort(
      ([, left], [, right]) =>
        this.runnerEventSeq(left.payload) - this.runnerEventSeq(right.payload),
    );
    if (pendingEvents.length === 0) {
      return;
    }

    const batchSize = state.supportsRunnerEventBatch
      ? MAX_RUNNER_EVENT_BATCH_SIZE
      : 1;
    if (!state.supportsRunnerEventBatch || pendingEvents.length >= batchSize) {
      this.clearPendingEventFlush(state);
      const batch = pendingEvents.slice(0, batchSize);
      this.pushPendingEventBatch(
        batch.map(([eventId]) => eventId),
        batch.map(([, event]) => event),
        state,
      );
      return;
    }

    this.schedulePendingEventFlush(state);
  }

  private flushPendingEventBatch(state: ThreadState): void {
    if (
      !this.isCurrentThreadState(state.threadId, state) ||
      state.activeEventBatch !== null ||
      state.pendingEvents.size === 0
    ) {
      return;
    }

    const batch = [...state.pendingEvents.entries()]
      .sort(
        ([, left], [, right]) =>
          this.runnerEventSeq(left.payload) -
          this.runnerEventSeq(right.payload),
      )
      .slice(0, MAX_RUNNER_EVENT_BATCH_SIZE);
    this.pushPendingEventBatch(
      batch.map(([eventId]) => eventId),
      batch.map(([, event]) => event),
      state,
    );
  }

  private retryActiveEventBatch(state: ThreadState): void {
    if (
      !this.isCurrentThreadState(state.threadId, state) ||
      this.failIfEventDeadlineExceeded(state)
    ) {
      return;
    }
    const activeBatch = state.activeEventBatch;
    if (activeBatch === null) {
      this.replayPendingEvents(state);
      return;
    }

    const events = activeBatch.eventIds
      .map((eventId) => state.pendingEvents.get(eventId))
      .filter(
        (
          event,
        ): event is { payload: Record<string, unknown>; queuedAt: number } =>
          event !== undefined,
      );
    if (events.length !== activeBatch.eventIds.length) {
      state.activeEventBatch = null;
      this.replayPendingEvents(state);
      return;
    }

    this.pushPendingEventBatch(activeBatch.eventIds, events, state);
  }

  private completeWhenDurable(threadId: string, state: ThreadState): void {
    if (
      !this.isCurrentThreadState(threadId, state) ||
      !state.producerFinished ||
      state.pendingEvents.size !== 0
    ) {
      return;
    }
    if (this.threads.get(threadId) !== state) {
      return;
    }

    this.removeThread(threadId, state);
    state.completeRun();
  }

  private runnerEventId(payload: Record<string, unknown>): string {
    const metadata = payload.metadata as Record<string, unknown>;
    return metadata.cpki_event_id as string;
  }

  private runnerEventSeq(payload: Record<string, unknown>): number {
    const metadata = payload.metadata as Record<string, unknown>;
    return metadata.cpki_event_seq as number;
  }

  private supportsRunnerEventBatch(response: unknown): boolean {
    if (typeof response !== "object" || response === null) {
      return false;
    }
    const capabilities = (response as { capabilities?: unknown }).capabilities;
    return (
      Array.isArray(capabilities) &&
      capabilities.includes(RUNNER_EVENT_BATCH_CAPABILITY)
    );
  }

  private isRetryableJoinError(response: unknown): boolean {
    if (typeof response !== "object" || response === null) {
      return false;
    }
    const value = response as { reason?: unknown; retryable?: unknown };
    if (value.retryable === false) {
      return false;
    }
    return value.retryable === true || value.reason === "gateway_draining";
  }

  private isPermanentEventFailure(response: unknown): boolean {
    return (
      typeof response === "object" &&
      response !== null &&
      (response as { retryable?: unknown }).retryable === false
    );
  }

  private scheduleEventDeadline(state: ThreadState): void {
    if (state.eventDeadlineTimer !== null) {
      clearTimeout(state.eventDeadlineTimer);
      state.eventDeadlineTimer = null;
    }
    if (
      !this.isCurrentThreadState(state.threadId, state) ||
      state.pendingEvents.size === 0
    ) {
      return;
    }

    const oldestQueuedAt = Math.min(
      ...[...state.pendingEvents.values()].map((event) => event.queuedAt),
    );
    const deadline = oldestQueuedAt + EVENT_DURABILITY_DEADLINE_MS;
    state.eventDeadlineTimer = setTimeout(
      () => {
        state.eventDeadlineTimer = null;
        if (!this.isCurrentThreadState(state.threadId, state)) {
          return;
        }

        if (!this.failIfEventDeadlineExceeded(state)) {
          this.scheduleEventDeadline(state);
        }
      },
      Math.max(0, deadline - Date.now()),
    );
  }

  private failThread(threadId: string, state: ThreadState, error: Error): void {
    if (!this.isCurrentThreadState(threadId, state)) {
      return;
    }
    this.removeThread(threadId, state);
    state.failRun(error);
  }

  private failIfEventDeadlineExceeded(state: ThreadState): boolean {
    if (state.pendingEvents.size === 0) {
      return false;
    }
    const oldestQueuedAt = Math.min(
      ...[...state.pendingEvents.values()].map((event) => event.queuedAt),
    );
    if (Date.now() < oldestQueuedAt + EVENT_DURABILITY_DEADLINE_MS) {
      return false;
    }
    this.failThread(
      state.threadId,
      state,
      new Error("Timed out trying to durably deliver runner events"),
    );
    return true;
  }

  private isCurrentThreadState(threadId: string, state: ThreadState): boolean {
    return state.isRunning && this.threads.get(threadId) === state;
  }

  /**
   * Tear down all resources for a thread: leave the channel,
   * disconnect the per-run socket, and remove the thread state.
   *
   * Idempotent — safe to call multiple times for the same threadId
   * (e.g. from join error handlers, finalize, and Observable teardown).
   */
  private removeThread(threadId: string, state: ThreadState): void {
    if (this.threads.get(threadId) !== state) {
      return;
    }

    // Delete first so concurrent calls see the entry as already removed.
    this.threads.delete(threadId);
    state.isRunning = false;
    this.clearPendingEventRetry(state);
    this.clearPendingEventFlush(state);
    if (state.eventDeadlineTimer !== null) {
      clearTimeout(state.eventDeadlineTimer);
      state.eventDeadlineTimer = null;
    }
    state.activeEventBatch = null;
    if (state.socketReconnectWatchdog !== null) {
      clearTimeout(state.socketReconnectWatchdog);
      state.socketReconnectWatchdog = null;
    }

    try {
      state.channel.leave();
    } catch {
      // Channel may already be closed/left.
    }
    try {
      state.socket.disconnect();
    } catch {
      // Socket may already be disconnected.
    }
  }
}
