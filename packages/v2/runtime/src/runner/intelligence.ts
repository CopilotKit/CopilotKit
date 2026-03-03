import {
  AgentRunner,
  AgentRunnerConnectRequest,
  AgentRunnerIsRunningRequest,
  AgentRunnerRunRequest,
  type AgentRunnerStopRequest,
} from "./agent-runner";
import { Observable, ReplaySubject } from "rxjs";
import { AbstractAgent, BaseEvent, EventType } from "@ag-ui/client";
import { finalizeRunEvents } from "@copilotkitnext/shared";
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

    // Register a listener for every AG-UI event type. The server pushes each
    // event using its EventType string as the Phoenix event name, with the
    // full BaseEvent object as the payload.
    for (const eventType of Object.values(EventType)) {
      channel.on(eventType, (payload: BaseEvent) => {
        runSubject.next(payload);
        currentEvents.push(payload);

        // Terminal AG-UI events signal the end of a run.
        if (
          payload.type === EventType.RUN_FINISHED ||
          payload.type === EventType.RUN_ERROR
        ) {
          this.finalizeAndComplete(state, threadId);
        }
      });
    }

    channel
      .join()
      .receive("ok", () => {
        // Kick off the run by sending a CUSTOM event with the full input.
        channel.push(EventType.CUSTOM, {
          type: EventType.CUSTOM,
          name: "run",
          value: {
            threadId: input.threadId,
            runId: input.runId,
            messages: input.messages,
            tools: input.tools,
            context: input.context,
            state: input.state,
            forwardedProps: input.forwardedProps,
          },
        });
      })
      .receive("error", (resp) => {
        const errorEvent = {
          type: EventType.RUN_ERROR,
          message: `Failed to join channel: ${JSON.stringify(resp)}`,
          code: "CHANNEL_JOIN_ERROR",
        } as BaseEvent;
        runSubject.next(errorEvent);
        currentEvents.push(errorEvent);
        this.cleanupThread(state);
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

    // Listen for all AG-UI event types the server may push (historic replay
    // and any in-progress run events).
    for (const eventType of Object.values(EventType)) {
      channel.on(eventType, (payload: BaseEvent) => {
        connectionSubject.next(payload);

        if (
          payload.type === EventType.RUN_FINISHED ||
          payload.type === EventType.RUN_ERROR
        ) {
          connectionSubject.complete();
        }
      });
    }

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

    // Ask the server to stop the run via a CUSTOM event.
    state.channel.push(EventType.CUSTOM, {
      type: EventType.CUSTOM,
      name: "stop",
      value: { threadId: request.threadId },
    });

    // Best-effort local abort.
    if (state.agent) {
      try {
        state.agent.abortRun();
      } catch {
        // Ignore — the server-side stop is the authority.
      }
    }

    return Promise.resolve(true);
  }

  // -------------------------------------------------------------------
  // Internal helpers
  // -------------------------------------------------------------------

  private finalizeAndComplete(state: ThreadState, threadId: string): void {
    const { runSubject, currentEvents, stopRequested } = state;
    if (!runSubject) return;

    const appended = finalizeRunEvents(currentEvents, {
      stopRequested,
    });
    for (const event of appended) {
      runSubject.next(event);
    }

    this.cleanupThread(state);
    runSubject.complete();
  }

  private cleanupThread(state: ThreadState): void {
    state.isRunning = false;
    state.agent = null;
    state.runSubject = null;
    state.stopRequested = false;
    state.channel.leave();
  }
}
