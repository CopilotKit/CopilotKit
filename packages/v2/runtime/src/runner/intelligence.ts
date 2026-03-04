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
import { finalizeRunEvents, AG_UI_CHANNEL_EVENT } from "@copilotkitnext/shared";
import { Socket, Channel } from "phoenix";

export interface IntelligenceAgentRunnerOptions {
  /** Phoenix websocket URL, e.g. "ws://localhost:4000/socket" */
  url: string;
  /** Optional params sent on socket connect (e.g. auth token) */
  socketParams?: Record<string, string>;
}

interface ThreadState {
  channel: Channel;
  isRunning: boolean;
  stopRequested: boolean;
  agent: AbstractAgent | null;
  currentEvents: BaseEvent[];
}

export class IntelligenceAgentRunner extends AgentRunner {
  private socket: Socket;
  private threads = new Map<string, ThreadState>();

  constructor(options: IntelligenceAgentRunnerOptions) {
    super();
    this.socket = new Socket(options.url, {
      params: options.socketParams ?? {},
    });
    this.socket.connect();
  }

  run(request: AgentRunnerRunRequest): Observable<BaseEvent> {
    const { threadId, agent, input } = request;

    const existing = this.threads.get(threadId);
    if (existing?.isRunning) {
      throw new Error("Thread already running");
    }

    return new Observable((observer) => {
      const currentEvents: BaseEvent[] = [];

      const channel = this.socket.channel(`agent:${threadId}`, {
        runId: input.runId,
      });

      const state: ThreadState = {
        channel,
        isRunning: true,
        stopRequested: false,
        agent,
        currentEvents,
      };
      this.threads.set(threadId, state);

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
          currentEvents.push(errorEvent);
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
      const channel = this.socket.channel(`agent:${threadId}`, {
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
        .receive("error", () => {
          observer.complete();
        });

      return () => {
        channel.leave();
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

  private removeThread(threadId: string): void {
    const state = this.threads.get(threadId);
    if (state) {
      state.channel.leave();
      this.threads.delete(threadId);
    }
  }
}
