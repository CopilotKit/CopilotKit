import {
  AgentRunner,
  AgentRunnerConnectRequest,
  AgentRunnerIsRunningRequest,
  AgentRunnerRunRequest,
  type AgentRunnerStopRequest,
} from "./agent-runner";
import { EMPTY, Observable, from } from "rxjs";
import { catchError, finalize } from "rxjs/operators";
import {
  AbstractAgent,
  BaseEvent,
  EventType,
  RunStartedEvent,
} from "@ag-ui/client";
import {
  finalizeRunEvents,
  AG_UI_CHANNEL_EVENT,
  phoenixExponentialBackoff,
} from "@copilotkit/shared";
import { Socket, Channel } from "phoenix";
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
  socket: Socket;
  channel: Channel;
  isRunning: boolean;
  stopRequested: boolean;
  agent: AbstractAgent | null;
  currentEvents: BaseEvent[];
  nextEventSeq: number;
  hasRunStarted: boolean;
}

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
  private createSocket(): Socket {
    const socket = new Socket(this.options.url, {
      ...(this.options.authToken ? { authToken: this.options.authToken } : {}),
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
    return {
      ...(event as BaseEvent & Record<string, unknown>),
      threadId: request.threadId,
      runId: request.input.runId,
    } as BaseEvent;
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

    return {
      ...eventRecord,
      metadata: {
        ...existingMetadata,
        cpki_event_id:
          typeof existingMetadata.cpki_event_id === "string"
            ? existingMetadata.cpki_event_id
            : randomUUID(),
        cpki_event_seq: eventSeq,
      },
    };
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
      const socket = this.createSocket();

      const channel = socket.channel(`ingestion:${input.runId}`, {
        thread_id: threadId,
        run_id: input.runId,
      });

      const state: ThreadState = {
        socket,
        channel,
        isRunning: true,
        stopRequested: false,
        agent,
        currentEvents: [],
        nextEventSeq: 1,
        hasRunStarted: false,
      };
      this.threads.set(threadId, state);

      // Track consecutive socket errors for this run. Phoenix retries
      // automatically via reconnectAfterMs, but if the connection fails
      // repeatedly we abort the agent — otherwise runAgent() completes
      // normally, finalization events buffer silently on the dead
      // channel, and the client never receives them.
      //
      // Aborting the agent is the single trigger that cascades through
      // the existing error pipeline: runAgent() rejects → catchError
      // pushes RUN_ERROR → finalize calls finalizeRunEvents +
      // removeThread → channel.leave() + socket.disconnect().
      const MAX_CONSECUTIVE_ERRORS = 5;
      let consecutiveErrors = 0;

      socket.onError(() => {
        consecutiveErrors++;
        if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS && state.agent) {
          try {
            state.agent.abortRun();
          } catch {
            // Ignore abort errors.
          }
        }
        // Otherwise: Phoenix retries automatically using the exponential
        // backoff schedule configured in createSocket().
      });

      socket.onOpen(() => {
        // A successful (re)connection resets the counter so transient
        // network blips don't accumulate across recoveries.
        consecutiveErrors = 0;
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
        .receive("ok", () => {
          startupBoundary?.resolveStartup();
          this.executeAgentRun(request, state, threadId).subscribe({
            complete: () => observer.complete(),
          });
        })
        .receive("error", (resp) => {
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
          this.removeThread(threadId);
          startupBoundary?.rejectStartup(error);
          observer.complete();
        })
        .receive("timeout", () => {
          const error = new Error("Timed out joining channel");
          const errorEvent = {
            type: EventType.RUN_ERROR,
            message: error.message,
            code: "CHANNEL_JOIN_TIMEOUT",
          } as BaseEvent;
          observer.next(errorEvent);
          state.currentEvents.push(errorEvent);
          this.removeThread(threadId);
          startupBoundary?.rejectStartup(error);
          observer.complete();
        });

      return () => {
        this.removeThread(threadId);
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

  private executeAgentRun(
    request: AgentRunnerRunRequest,
    state: ThreadState,
    threadId: string,
  ): Observable<void> {
    const { currentEvents, channel } = state;
    const pushCanonicalEvent = (event: BaseEvent): void => {
      const canonicalEvent = this.stampRunnerMetadata(
        this.stampCanonicalRunOwnership(event, request),
        state,
      );
      currentEvents.push(canonicalEvent);

      if (canonicalEvent.type === EventType.RUN_STARTED) {
        state.hasRunStarted = true;
      }

      channel.push(
        "event",
        this.createRunnerEventPayload(canonicalEvent, request, state),
      );
    };

    const getPersistedInputMessages = () =>
      request.persistedInputMessages ?? request.input.messages;

    const buildRunStartedEvent = (
      source?: RunStartedEvent,
    ): RunStartedEvent => {
      const baseInput = source?.input ?? request.input;
      const persistedInputMessages = getPersistedInputMessages();

      return {
        ...(source ?? {
          type: EventType.RUN_STARTED,
          threadId: request.threadId,
          runId: request.input.runId,
        }),
        threadId: request.threadId,
        runId: request.input.runId,
        input: {
          ...baseInput,
          threadId: request.threadId,
          runId: request.input.runId,
          ...(persistedInputMessages !== undefined
            ? { messages: persistedInputMessages }
            : {}),
        },
      } as RunStartedEvent;
    };

    const ensureRunStarted = (): void => {
      if (!state.hasRunStarted) {
        state.hasRunStarted = true;
        pushCanonicalEvent(buildRunStartedEvent());
      }
    };

    return from(
      request.agent.runAgent(request.input, {
        onEvent: ({ event }: { event: BaseEvent }) => {
          if (event.type === EventType.RUN_STARTED) {
            pushCanonicalEvent(buildRunStartedEvent(event as RunStartedEvent));
            return;
          }

          ensureRunStarted();
          pushCanonicalEvent(event);
        },
      }),
    ).pipe(
      catchError((error) => {
        ensureRunStarted();
        const errorEvent = {
          type: EventType.RUN_ERROR,
          message: error instanceof Error ? error.message : String(error),
        } as BaseEvent;
        pushCanonicalEvent(errorEvent);
        return EMPTY;
      }),
      finalize(() => {
        ensureRunStarted();
        const appended = finalizeRunEvents(currentEvents, {
          stopRequested: state.stopRequested,
        });
        for (const event of appended) {
          channel.push(
            "event",
            this.createRunnerEventPayload(event, request, state),
          );
        }
        this.removeThread(threadId);
      }),
    );
  }

  /**
   * Tear down all resources for a thread: leave the channel,
   * disconnect the per-run socket, and remove the thread state.
   *
   * Idempotent — safe to call multiple times for the same threadId
   * (e.g. from join error handlers, finalize, and Observable teardown).
   */
  private removeThread(threadId: string): void {
    const state = this.threads.get(threadId);
    if (!state) {
      return;
    }

    // Delete first so concurrent calls see the entry as already removed.
    this.threads.delete(threadId);

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
