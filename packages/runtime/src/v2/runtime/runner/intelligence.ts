import type {
  AgentRunnerConnectRequest,
  AgentRunnerExecuteRequest,
  AgentRunnerIsRunningRequest,
  AgentRunnerRunRequest,
  AgentTurnController,
} from "./agent-runner";
import { AgentRunner } from "./agent-runner";
import type { AgentRunnerStopRequest } from "./agent-runner";
import { EMPTY, Observable, from } from "rxjs";
import { catchError, finalize } from "rxjs/operators";
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
  socket: Socket;
  channel: Channel;
  isRunning: boolean;
  stopRequested: boolean;
  agent: AbstractAgent | null;
  currentEvents: BaseEvent[];
  nextEventSeq: number;
  hasRunStarted: boolean;
  /**
   * Aborts the in-flight outer run's turn body (via {@link AgentTurnController}
   * `signal`) for `execute()`. Null on the single-agent `run()` path.
   */
  abortController: AbortController | null;
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

  /**
   * Run a complete Channel turn as one fenced OUTER run (Task 1). Opens one
   * canonical ingestion channel for the outer run, then runs the turn body —
   * which may invoke `controller.runAgent` zero or more times. Inner agents'
   * RUN_STARTED/RUN_FINISHED are suppressed; the outer run pushes exactly one
   * canonical RUN_STARTED and exactly one terminal over the channel.
   */
  execute(request: AgentRunnerExecuteRequest): Observable<BaseEvent> {
    const { threadId } = request;

    const existing = this.threads.get(threadId);
    if (existing?.isRunning) {
      throw new Error("Thread already running");
    }

    return new Observable((observer) => {
      const socket = this.createSocket();
      const channel = socket.channel(`ingestion:${request.runId}`, {
        thread_id: threadId,
        run_id: request.runId,
      });

      const abortController = new AbortController();
      const state: ThreadState = {
        socket,
        channel,
        isRunning: true,
        stopRequested: false,
        agent: null,
        currentEvents: [],
        nextEventSeq: 1,
        hasRunStarted: false,
        abortController,
      };
      this.threads.set(threadId, state);

      // Same repeated-socket-error escape hatch as createRunObservable: abort
      // the turn (and its in-flight agent) so finalization is not lost on a
      // dead channel.
      const MAX_CONSECUTIVE_ERRORS = 5;
      let consecutiveErrors = 0;
      socket.onError(() => {
        consecutiveErrors++;
        if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
          abortController.abort();
          if (state.agent) {
            try {
              state.agent.abortRun();
            } catch {
              // Ignore abort errors.
            }
          }
        }
      });
      socket.onOpen(() => {
        consecutiveErrors = 0;
      });

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
          this.executeTurn(request, state, threadId).subscribe({
            complete: () => observer.complete(),
          });
        })
        .receive("error", (resp) => {
          const errorEvent = {
            type: EventType.RUN_ERROR,
            message: `Failed to join channel: ${JSON.stringify(resp)}`,
            code: "CHANNEL_JOIN_ERROR",
          } as BaseEvent;
          observer.next(errorEvent);
          state.currentEvents.push(errorEvent);
          this.removeThread(threadId);
          observer.complete();
        })
        .receive("timeout", () => {
          const errorEvent = {
            type: EventType.RUN_ERROR,
            message: "Timed out joining channel",
            code: "CHANNEL_JOIN_TIMEOUT",
          } as BaseEvent;
          observer.next(errorEvent);
          state.currentEvents.push(errorEvent);
          this.removeThread(threadId);
          observer.complete();
        });

      return () => {
        this.removeThread(threadId);
      };
    });
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
        abortController: null,
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

    // Fire the execute() turn's abort signal (null on the run() path).
    state.abortController?.abort();

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

  // The emitted values are ignored by the caller (only `complete` matters);
  // `runAgent()` resolves with a RunAgentResult that flows through `from()`.
  private executeAgentRun(
    request: AgentRunnerRunRequest,
    state: ThreadState,
    threadId: string,
  ): Observable<unknown> {
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

  // Runs the turn body under one outer canonical run. Emitted values are
  // ignored (only `complete` matters); events are pushed over the channel.
  private executeTurn(
    request: AgentRunnerExecuteRequest,
    state: ThreadState,
    threadId: string,
  ): Observable<unknown> {
    const { currentEvents, channel } = state;

    // The canonical stamping helpers key off `input.runId`; pin it to the
    // OUTER run id so every inner agent's events land under one canonical run.
    const canonicalInput = {
      ...request.input,
      threadId: request.threadId,
      runId: request.runId,
    };
    const canonicalRequest: AgentRunnerRunRequest = {
      threadId: request.threadId,
      // Unused by the stamping helpers (they read threadId + input.runId only);
      // the per-inner-run agent lives on `state.agent`.
      agent: undefined as unknown as AbstractAgent,
      input: canonicalInput,
      ...(request.persistedInputMessages !== undefined
        ? { persistedInputMessages: request.persistedInputMessages }
        : {}),
    };

    const pushCanonicalEvent = (event: BaseEvent): void => {
      const canonicalEvent = this.stampRunnerMetadata(
        this.stampCanonicalRunOwnership(event, canonicalRequest),
        state,
      );
      currentEvents.push(canonicalEvent);
      if (canonicalEvent.type === EventType.RUN_STARTED) {
        state.hasRunStarted = true;
      }
      channel.push(
        "event",
        this.createRunnerEventPayload(canonicalEvent, canonicalRequest, state),
      );
    };

    const persistedInputMessages =
      request.persistedInputMessages ?? request.input.messages;

    const ensureRunStarted = (): void => {
      if (state.hasRunStarted) return;
      state.hasRunStarted = true;
      pushCanonicalEvent({
        type: EventType.RUN_STARTED,
        threadId: request.threadId,
        runId: request.runId,
        input: {
          ...canonicalInput,
          ...(persistedInputMessages !== undefined
            ? { messages: persistedInputMessages }
            : {}),
        },
      } as RunStartedEvent);
    };

    let innerError: Error | null = null;

    const controller: AgentTurnController = {
      signal: state.abortController?.signal ?? new AbortController().signal,
      runAgent: async (inner) => {
        state.agent = inner.agent;
        await inner.agent.runAgent(inner.input, {
          onEvent: ({ event }: { event: BaseEvent }) => {
            if (event.type === EventType.RUN_STARTED) {
              ensureRunStarted();
              return;
            }
            if (event.type === EventType.RUN_FINISHED) {
              return;
            }
            if (event.type === EventType.RUN_ERROR) {
              innerError =
                innerError ??
                new Error(
                  (event as BaseEvent & { message?: string }).message ??
                    "inner run error",
                );
              return;
            }
            ensureRunStarted();
            pushCanonicalEvent(event);
          },
        });
        if (innerError) throw innerError;
      },
    };

    return from(
      (async () => {
        try {
          await request.turn(controller);
          // An inner error only fails the outer run when NOT aborted; an
          // aborted turn settles as "stopped" (RUN_FINISHED), not "errored".
          if (innerError && !state.abortController?.signal.aborted) {
            throw innerError;
          }
          ensureRunStarted();
          pushCanonicalEvent({
            type: EventType.RUN_FINISHED,
            threadId: request.threadId,
            runId: request.runId,
          } as BaseEvent);
        } catch (error) {
          ensureRunStarted();
          if (state.abortController?.signal.aborted) {
            // Stopped, not errored: the terminal closes open sub-events.
            pushCanonicalEvent({
              type: EventType.RUN_FINISHED,
              threadId: request.threadId,
              runId: request.runId,
            } as BaseEvent);
          } else {
            pushCanonicalEvent({
              type: EventType.RUN_ERROR,
              message: error instanceof Error ? error.message : String(error),
              code: "OUTER_RUN_FAILED",
            } as BaseEvent);
          }
        }
      })(),
    ).pipe(
      finalize(() => {
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
