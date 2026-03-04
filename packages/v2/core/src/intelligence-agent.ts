import {
  AbstractAgent,
  RunAgentInput,
  EventType,
  BaseEvent,
} from "@ag-ui/client";
import { Observable } from "rxjs";
import { Socket, Channel } from "phoenix";
import { AG_UI_CHANNEL_EVENT } from "@copilotkitnext/shared";

export interface IntelligenceAgentConfig {
  /** Phoenix websocket URL, e.g. "ws://localhost:4000/socket" */
  url: string;
  /** Runtime REST URL, e.g. "http://localhost:4000" */
  runtimeUrl: string;
  /** Agent identifier for REST endpoints */
  agentId: string;
  /** Optional params sent on socket connect (e.g. auth token) */
  socketParams?: Record<string, string>;
  /** Optional headers sent with REST requests */
  headers?: Record<string, string>;
  /** Optional credentials mode for fetch requests */
  credentials?: RequestCredentials;
}

export class IntelligenceAgent extends AbstractAgent {
  private config: IntelligenceAgentConfig;
  private socket: Socket | null = null;
  private activeChannel: Channel | null = null;
  private threadId: string | null = null;

  constructor(config: IntelligenceAgentConfig) {
    super();
    this.config = config;
  }

  clone(): IntelligenceAgent {
    return new IntelligenceAgent(this.config);
  }

  abortRun(): void {
    if (!this.threadId) {
      return;
    }

    if (typeof fetch === "undefined") {
      this.cleanup();
      return;
    }

    const { runtimeUrl, agentId, headers, credentials } = this.config;
    const stopPath = `${runtimeUrl}/agent/${encodeURIComponent(agentId)}/stop/${encodeURIComponent(this.threadId)}`;
    const origin =
      typeof window !== "undefined" && window.location
        ? window.location.origin
        : "http://localhost";
    const stopUrl = new URL(stopPath, new URL(runtimeUrl, origin));

    fetch(stopUrl.toString(), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...headers,
      },
      ...(credentials ? { credentials } : {}),
    }).catch((error) => {
      console.error("IntelligenceAgent: stop request failed", error);
    });

    this.cleanup();
  }

  /**
   * Connect to a Phoenix channel scoped to the thread, trigger the run via
   * REST, and relay server-pushed AG-UI events to the Observable subscriber.
   *
   * The server pushes each AG-UI event using its EventType string as the
   * Phoenix event name (e.g. "TEXT_MESSAGE_CHUNK", "TOOL_CALL_START"), with
   * the full BaseEvent as payload. RUN_FINISHED and RUN_ERROR are terminal
   * events that complete or error the Observable.
   */
  run(input: RunAgentInput): Observable<BaseEvent> {
    return new Observable<BaseEvent>((observer) => {
      this.threadId = input.threadId;

      // 1. Establish socket connection
      const socket = new Socket(this.config.url, {
        params: this.config.socketParams ?? {},
      });
      this.socket = socket;
      socket.connect();

      // 2. Join a channel scoped to this thread/run
      const channel = socket.channel(`agent:${input.threadId}`, {
        runId: input.runId,
      });
      this.activeChannel = channel;

      // 3. Listen for AG-UI events pushed by the server
      channel.on(AG_UI_CHANNEL_EVENT, (payload: BaseEvent) => {
        observer.next(payload);

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

      // 4. Join the channel, then trigger the run via REST
      channel
        .join()
        .receive("ok", () => {
          const { runtimeUrl, agentId, headers, credentials } = this.config;
          const runPath = `${runtimeUrl}/agent/${encodeURIComponent(agentId)}/run`;
          const origin =
            typeof window !== "undefined" && window.location
              ? window.location.origin
              : "http://localhost";
          const runUrl = new URL(runPath, new URL(runtimeUrl, origin));

          fetch(runUrl.toString(), {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              ...headers,
            },
            body: JSON.stringify({
              threadId: input.threadId,
              runId: input.runId,
              messages: input.messages,
              tools: input.tools,
              context: input.context,
              state: input.state,
              forwardedProps: input.forwardedProps,
            }),
            ...(credentials ? { credentials } : {}),
          }).catch((error) => {
            observer.error(
              new Error(`REST run request failed: ${error.message ?? error}`),
            );
            this.cleanup();
          });
        })
        .receive("error", (resp) => {
          observer.error(
            new Error(`Failed to join channel: ${JSON.stringify(resp)}`),
          );
          this.cleanup();
        })
        .receive("timeout", () => {
          observer.error(new Error("Timed out joining channel"));
          this.cleanup();
        });

      // 5. Teardown on unsubscribe
      return () => {
        this.cleanup();
      };
    });
  }

  /**
   * Reconnect to an existing thread by joining the Phoenix channel in
   * "connect" mode and requesting the server replay history.
   */
  protected connect(input: RunAgentInput): Observable<BaseEvent> {
    return new Observable<BaseEvent>((observer) => {
      this.threadId = input.threadId;

      const socket = new Socket(this.config.url, {
        params: this.config.socketParams ?? {},
      });
      this.socket = socket;
      socket.connect();

      const channel = socket.channel(`agent:${input.threadId}`, {
        mode: "connect",
      });
      this.activeChannel = channel;

      channel.on(AG_UI_CHANNEL_EVENT, (payload: BaseEvent) => {
        observer.next(payload);

        if (
          payload.type === EventType.RUN_FINISHED ||
          payload.type === EventType.RUN_ERROR
        ) {
          observer.complete();
          this.cleanup();
        }
      });

      channel
        .join()
        .receive("ok", () => {
          channel.push(EventType.CUSTOM, {
            type: EventType.CUSTOM,
            name: "connect",
            value: { threadId: input.threadId },
          });
        })
        .receive("error", (resp) => {
          observer.error(
            new Error(`Failed to join channel: ${JSON.stringify(resp)}`),
          );
          this.cleanup();
        })
        .receive("timeout", () => {
          observer.error(new Error("Timed out joining channel"));
          this.cleanup();
        });

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
