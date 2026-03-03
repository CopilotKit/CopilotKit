import {
  AbstractAgent,
  RunAgentInput,
  EventType,
  BaseEvent,
} from "@ag-ui/client";
import { Observable } from "rxjs";
import { Socket, Channel } from "phoenix";

export interface IntelligenceAgentConfig {
  /** Phoenix websocket URL, e.g. "ws://localhost:4000/socket" */
  url: string;
  /** Optional params sent on socket connect (e.g. auth token) */
  socketParams?: Record<string, string>;
}

export class IntelligenceAgent extends AbstractAgent {
  private config: IntelligenceAgentConfig;
  private socket: Socket | null = null;
  private activeChannel: Channel | null = null;

  constructor(config: IntelligenceAgentConfig) {
    super();
    this.config = config;
  }

  clone(): IntelligenceAgent {
    return new IntelligenceAgent(this.config);
  }

  abortRun(): void {
    if (this.activeChannel) {
      this.activeChannel.push(EventType.CUSTOM, {
        type: EventType.CUSTOM,
        name: "stop",
        value: {},
      });
      this.activeChannel.leave();
      this.activeChannel = null;
    }
  }

  /**
   * Connect to a Phoenix channel scoped to the thread, send the run input,
   * and relay server-pushed AG-UI events to the Observable subscriber.
   *
   * The server pushes each AG-UI event using its EventType string as the
   * Phoenix event name (e.g. "TEXT_MESSAGE_CHUNK", "TOOL_CALL_START"), with
   * the full BaseEvent as payload. RUN_FINISHED and RUN_ERROR are terminal
   * events that complete or error the Observable.
   */
  run(input: RunAgentInput): Observable<BaseEvent> {
    return new Observable<BaseEvent>((observer) => {
      // ---------------------------------------------------------------
      // 1. Establish socket connection
      // ---------------------------------------------------------------
      const socket = new Socket(this.config.url, {
        params: this.config.socketParams ?? {},
      });
      this.socket = socket;
      socket.connect();

      // ---------------------------------------------------------------
      // 2. Join a channel scoped to this thread/run
      // ---------------------------------------------------------------
      const channel = socket.channel(`agent:${input.threadId}`, {
        runId: input.runId,
      });
      this.activeChannel = channel;

      // ---------------------------------------------------------------
      // 3. Register a listener for every AG-UI event type. The server
      //    pushes each event using its EventType string as the Phoenix
      //    event name, with the full BaseEvent object as the payload.
      // ---------------------------------------------------------------
      for (const eventType of Object.values(EventType)) {
        channel.on(eventType, (payload: BaseEvent) => {
          observer.next(payload);

          // Terminal AG-UI events signal the end of a run.
          if (payload.type === EventType.RUN_FINISHED) {
            observer.complete();
            this.cleanup();
          } else if (payload.type === EventType.RUN_ERROR) {
            observer.error(
              new Error(
                (payload as BaseEvent & { message?: string }).message ??
                  "Run error",
              ),
            );
            this.cleanup();
          }
        });
      }

      // ---------------------------------------------------------------
      // 4. Join the channel and kick off the run
      // ---------------------------------------------------------------
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
          observer.next(errorEvent);
          observer.error(
            new Error(`Failed to join channel: ${JSON.stringify(resp)}`),
          );
          this.cleanup();
        })
        .receive("timeout", () => {
          const errorEvent = {
            type: EventType.RUN_ERROR,
            message: "Timed out joining channel",
            code: "CHANNEL_JOIN_TIMEOUT",
          } as BaseEvent;
          observer.next(errorEvent);
          observer.error(new Error("Timed out joining channel"));
          this.cleanup();
        });

      // ---------------------------------------------------------------
      // 5. Teardown when the Observable is unsubscribed
      // ---------------------------------------------------------------
      return () => {
        this.cleanup();
      };
    });
  }

  private cleanup(): void {
    if (this.activeChannel) {
      this.activeChannel.leave();
      this.activeChannel = null;
    }
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
    }
  }
}
