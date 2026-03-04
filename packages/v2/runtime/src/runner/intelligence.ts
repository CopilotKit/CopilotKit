import {
  AgentRunner,
  AgentRunnerConnectRequest,
  AgentRunnerIsRunningRequest,
  AgentRunnerRunRequest,
  type AgentRunnerStopRequest,
} from "./agent-runner";
import { Observable, ReplaySubject } from "rxjs";
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
  runSubject: ReplaySubject<BaseEvent> | null;
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

    const runSubject = new ReplaySubject<BaseEvent>(Infinity);
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
      runSubject,
    };
    this.threads.set(threadId, state);

    channel
      .join()
      .receive("ok", () => {
        this.executeAgentRun(request, state, threadId);
      })
      .receive("error", (resp) => {
        const errorEvent = {
          type: EventType.RUN_ERROR,
          message: `Failed to join channel: ${JSON.stringify(resp)}`,
          code: "CHANNEL_JOIN_ERROR",
        } as BaseEvent;
        runSubject.next(errorEvent);
        currentEvents.push(errorEvent);
        this.removeThread(threadId);
        runSubject.complete();
      });

    return runSubject.asObservable();
  }

  connect(request: AgentRunnerConnectRequest): Observable<BaseEvent> {
    const { threadId } = request;
    const connectionSubject = new ReplaySubject<BaseEvent>(Infinity);

    const channel = this.socket.channel(`agent:${threadId}`, {
      mode: "connect",
    });

    // Listen for AG-UI events on a single channel event name.
    channel.on(AG_UI_CHANNEL_EVENT, (payload: BaseEvent) => {
      connectionSubject.next(payload);

      if (
        payload.type === EventType.RUN_FINISHED ||
        payload.type === EventType.RUN_ERROR
      ) {
        connectionSubject.complete();
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
        connectionSubject.complete();
      });

    return connectionSubject.asObservable();
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

  // -------------------------------------------------------------------
  // Internal helpers
  // -------------------------------------------------------------------

  private async executeAgentRun(
    request: AgentRunnerRunRequest,
    state: ThreadState,
    threadId: string,
  ): Promise<void> {
    const { runSubject, currentEvents, channel } = state;
    if (!runSubject) return;

    try {
      await request.agent.runAgent(request.input, {
        onEvent: ({ event }: { event: BaseEvent }) => {
          currentEvents.push(event);

          // Push to Phoenix channel so frontend WS listeners receive it.
          channel.push(AG_UI_CHANNEL_EVENT, event);
        },
      });
    } catch (error) {
      const errorEvent = {
        type: EventType.RUN_ERROR,
        message: error instanceof Error ? error.message : String(error),
      } as BaseEvent;
      currentEvents.push(errorEvent);
      channel.push(AG_UI_CHANNEL_EVENT, errorEvent);
    }

    // Finalize in both success and error paths.
    const appended = finalizeRunEvents(currentEvents, {
      stopRequested: state.stopRequested,
    });
    for (const event of appended) {
      channel.push(AG_UI_CHANNEL_EVENT, event);
    }

    this.removeThread(threadId);
    runSubject.complete();
  }

  private removeThread(threadId: string): void {
    const state = this.threads.get(threadId);
    if (state) {
      state.channel.leave();
      this.threads.delete(threadId);
    }
  }
}
