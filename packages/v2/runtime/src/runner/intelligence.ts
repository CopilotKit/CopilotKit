import {
  AgentRunner,
  AgentRunnerConnectRequest,
  AgentRunnerIsRunningRequest,
  AgentRunnerRunRequest,
  type AgentRunnerStopRequest,
} from "./agent-runner";
import { EMPTY, Observable, from } from "rxjs";
import { catchError, finalize } from "rxjs/operators";
import { AbstractAgent, BaseEvent, EventType } from "@ag-ui/client";
import {
  finalizeRunEvents,
  AG_UI_CHANNEL_EVENT,
  phoenixExponentialBackoff,
} from "@copilotkitnext/shared";
import { Socket, Channel } from "phoenix";

export interface IntelligenceAgentRunnerOptions {
  /** Phoenix websocket URL, e.g. "ws://localhost:4000/socket" */
  url: string;
  /** Optional params sent on socket connect (e.g. auth token) */
  socketParams?: Record<string, string>;
}

interface ThreadState {
  socket: Socket;
  channel: Channel;
  isRunning: boolean;
  stopRequested: boolean;
  agent: AbstractAgent | null;
  currentEvents: BaseEvent[];
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
   *   after an unclean close. 100ms base, doubling up to a 10s cap.
   *
   * rejoinAfterMs — delay before Phoenix re-joins a channel that
   *   entered the "errored" state. 1s base, doubling up to 30s cap.
   *
   * These are set explicitly because Phoenix's default schedule is a
   * fixed stepped array (not exponential), and any code that calls
   * socket.disconnect() in an onError handler will set
   * closeWasClean = true and reset the reconnect timer — permanently
   * killing retries.
   */
  private createSocket(): Socket {
    const socket = new Socket(this.options.url, {
      params: this.options.socketParams ?? {},
      reconnectAfterMs: phoenixExponentialBackoff(100, 10_000),
      rejoinAfterMs: phoenixExponentialBackoff(1_000, 30_000),
    });
    socket.connect();
    return socket;
  }

  run(request: AgentRunnerRunRequest): Observable<BaseEvent> {
    const { threadId, agent, input } = request;

    const existing = this.threads.get(threadId);
    if (existing?.isRunning) {
      throw new Error("Thread already running");
    }

    return new Observable((observer) => {
      const socket = this.createSocket();

      const channel = socket.channel(`agent:${threadId}`, {
        runId: input.runId,
      });

      const state: ThreadState = {
        socket,
        channel,
        isRunning: true,
        stopRequested: false,
        agent,
        currentEvents: [],
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
          this.executeAgentRun(request, state, threadId).subscribe({
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

  connect(request: AgentRunnerConnectRequest): Observable<BaseEvent> {
    const { threadId } = request;

    return new Observable((observer) => {
      const socket = this.createSocket();

      const channel = socket.channel(`agent:${threadId}`, {
        mode: "connect",
      });

      // Listen for AG-UI events on a single channel event name.
      channel.on(AG_UI_CHANNEL_EVENT, (payload: BaseEvent) => {
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
        .receive("ok", () => {
          // Ask the server to replay history via a CUSTOM event.
          channel.push(EventType.CUSTOM, {
            type: EventType.CUSTOM,
            name: "connect",
            value: { threadId },
          });
        })
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

    return from(
      request.agent.runAgent(request.input, {
        onEvent: ({ event }: { event: BaseEvent }) => {
          currentEvents.push(event);

          // Push to Phoenix channel so frontend WS listeners receive it.
          channel.push(AG_UI_CHANNEL_EVENT, event);
        },
      }),
    ).pipe(
      catchError((error) => {
        const errorEvent = {
          type: EventType.RUN_ERROR,
          message: error instanceof Error ? error.message : String(error),
        } as BaseEvent;
        currentEvents.push(errorEvent);
        channel.push(AG_UI_CHANNEL_EVENT, errorEvent);
        return EMPTY;
      }),
      finalize(() => {
        const appended = finalizeRunEvents(currentEvents, {
          stopRequested: state.stopRequested,
        });
        for (const event of appended) {
          channel.push(AG_UI_CHANNEL_EVENT, event);
        }
        this.removeThread(threadId);
      }),
    );
  }

  /**
   * Tear down all resources for a thread: leave the channel,
   * disconnect the per-run socket, and remove the thread state.
   */
  private removeThread(threadId: string): void {
    const state = this.threads.get(threadId);
    if (state) {
      state.channel.leave();
      state.socket.disconnect();
      this.threads.delete(threadId);
    }
  }
}
