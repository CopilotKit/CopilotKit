import {
  AbstractAgent,
  RunAgentInput,
  EventType,
  BaseEvent,
} from "@ag-ui/client";
import { Observable, defer, switchMap } from "rxjs";
import { Socket, Channel } from "phoenix";
import { phoenixExponentialBackoff } from "@copilotkitnext/shared";

const CLIENT_AG_UI_EVENT = "ag_ui_event";
const STOP_RUN_EVENT = "stop_run";

interface ThreadJoinCredentials {
  joinToken: string;
}

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
  private runId: string | null = null;

  constructor(config: IntelligenceAgentConfig) {
    super();
    this.config = config;
  }

  clone(): IntelligenceAgent {
    return new IntelligenceAgent(this.config);
  }

  abortRun(): void {
    if (this.activeChannel && this.runId) {
      // Defer cleanup until the push is acknowledged so socket.disconnect()
      // doesn't clear the push buffer before the stop signal is sent.
      // The 5-second fallback handles the case where the socket is down and
      // Phoenix never flushes the buffered push (its .receive("timeout") only
      // fires for pushes that were actually sent but not replied to).
      const fallback = setTimeout(() => this.cleanup(), 5_000);
      const clear = () => {
        clearTimeout(fallback);
        this.cleanup();
      };

      this.activeChannel
        .push(STOP_RUN_EVENT, { run_id: this.runId })
        .receive("ok", clear)
        .receive("error", clear)
        .receive("timeout", clear);
    } else {
      this.cleanup();
    }
  }

  /**
   * Trigger the run via REST, then join the realtime thread channel and relay
   * server-pushed AG-UI events to the Observable subscriber.
   */
  run(input: RunAgentInput): Observable<BaseEvent> {
    this.threadId = input.threadId;
    this.runId = input.runId;

    return defer(() => this.requestJoinCredentials$("run", input)).pipe(
      switchMap((credentials) =>
        this.observeThread$(input, credentials, { completeOnRunError: false }),
      ),
    );
  }

  /**
   * Reconnect to an existing thread by fetching websocket credentials and
   * joining the realtime thread channel.
   */
  protected connect(input: RunAgentInput): Observable<BaseEvent> {
    this.threadId = input.threadId;
    this.runId = input.runId;

    return defer(() => this.requestJoinCredentials$("connect", input)).pipe(
      switchMap((credentials) =>
        this.observeThread$(input, credentials, { completeOnRunError: true }),
      ),
    );
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
    this.runId = null;
  }

  private requestJoinCredentials$(
    mode: "run" | "connect",
    input: RunAgentInput,
  ): Observable<ThreadJoinCredentials> {
    return defer(async () => {
      try {
        const response = await fetch(this.buildRuntimeUrl(mode), {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...this.config.headers,
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
          ...(this.config.credentials
            ? { credentials: this.config.credentials }
            : {}),
        });

        if (!response.ok) {
          const text = await response.text().catch(() => "");
          throw new Error(
            text || response.statusText || String(response.status),
          );
        }

        const payload =
          (await response.json()) as Partial<ThreadJoinCredentials>;
        if (!payload.joinToken) {
          throw new Error("missing joinToken");
        }

        return { joinToken: payload.joinToken };
      } catch (error) {
        throw new Error(
          `REST ${mode} request failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    });
  }

  private observeThread$(
    input: RunAgentInput,
    credentials: ThreadJoinCredentials,
    options: { completeOnRunError: boolean },
  ): Observable<BaseEvent> {
    return new Observable<BaseEvent>((observer) => {
      const socket = new Socket(this.config.url, {
        params: {
          ...(this.config.socketParams ?? {}),
          join_token: credentials.joinToken,
        },
        reconnectAfterMs: phoenixExponentialBackoff(100, 10_000),
        rejoinAfterMs: phoenixExponentialBackoff(1_000, 30_000),
      });
      this.socket = socket;
      socket.connect();

      const channel = socket.channel(`thread:${input.threadId}`, {});
      this.activeChannel = channel;

      channel.on(CLIENT_AG_UI_EVENT, (payload: BaseEvent) => {
        observer.next(payload);

        if (payload.type === EventType.RUN_FINISHED) {
          observer.complete();
          this.cleanup();
        } else if (payload.type === EventType.RUN_ERROR) {
          if (options.completeOnRunError) {
            observer.complete();
          } else {
            observer.error(
              new Error(
                (payload as BaseEvent & { message?: string }).message ??
                  "Run error",
              ),
            );
          }
          this.cleanup();
        }
      });

      const MAX_CONSECUTIVE_ERRORS = 5;
      let consecutiveErrors = 0;

      socket.onError(() => {
        consecutiveErrors++;
        if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
          observer.error(
            new Error(
              `WebSocket connection failed after ${MAX_CONSECUTIVE_ERRORS} consecutive errors`,
            ),
          );
          this.cleanup();
        }
      });

      socket.onOpen(() => {
        consecutiveErrors = 0;
      });

      channel.onError(() => {});

      channel
        .join()
        .receive("ok", () => undefined)
        .receive("error", (resp: unknown) => {
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

  private buildRuntimeUrl(mode: "run" | "connect"): string {
    const path = `${this.config.runtimeUrl}/agent/${encodeURIComponent(this.config.agentId)}/${mode}`;
    const origin =
      typeof window !== "undefined" && window.location
        ? window.location.origin
        : "http://localhost";

    return new URL(path, new URL(this.config.runtimeUrl, origin)).toString();
  }
}
