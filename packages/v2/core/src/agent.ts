import {
  AbstractAgent,
  BaseEvent,
  EventSchemas,
  EventType,
  HttpAgent,
  HttpAgentConfig,
  RunAgentInput,
  runHttpRequest,
  transformHttpEventStream,
} from "@ag-ui/client";
import { Observable, EMPTY } from "rxjs";
import { catchError } from "rxjs/operators";
import {
  CopilotRuntimeTransport,
  WebSocketAgentConfig,
  WebSocketTokenResponse,
} from "./types";

/**
 * Check if an error is a ZodError (validation error).
 * These can occur when the SSE stream is aborted/truncated mid-event.
 */
function isZodError(error: unknown): boolean {
  return (
    error !== null &&
    typeof error === "object" &&
    "name" in error &&
    (error as { name: string }).name === "ZodError"
  );
}

/**
 * Wrap an Observable to catch and suppress ZodErrors that occur during stream abort.
 * These errors are expected when the connection is cancelled mid-stream.
 */
function withAbortErrorHandling(
  observable: Observable<BaseEvent>,
): Observable<BaseEvent> {
  return observable.pipe(
    catchError((error) => {
      if (isZodError(error)) {
        // Suppress ZodErrors - these occur when the stream is aborted mid-event
        // and the parser receives incomplete data
        return EMPTY;
      }
      // Re-throw other errors
      throw error;
    }),
  );
}

type TokenSubscription = {
  observerCount: number;
  observers: Set<{
    next: (event: BaseEvent) => void;
    error: (error: Error) => void;
    complete: () => void;
  }>;
};

type PhoenixMessage = [string | null, string | null, string, string, unknown];

class WebSocketSessionManager {
  private socket?: WebSocket;
  private subscriptions = new Map<string, TokenSubscription>();
  private pendingTokens = new Set<string>();
  private joinedTokens = new Set<string>();
  private refCounter = 0;
  private joinRefCounter = 0;
  private heartbeatHandle?: ReturnType<typeof setInterval>;

  constructor(
    private readonly wsUrl: string,
    private readonly onIdle?: () => void,
  ) {}

  subscribe(token: string): Observable<BaseEvent> {
    return new Observable<BaseEvent>((subscriber) => {
      const subscription = this.getOrCreateSubscription(token);
      const observer = {
        next: (event: BaseEvent) => subscriber.next(event),
        error: (error: Error) => subscriber.error(error),
        complete: () => subscriber.complete(),
      };

      subscription.observers.add(observer);
      subscription.observerCount += 1;
      this.connectIfNeeded();
      this.subscribeToken(token);

      return () => {
        this.removeObserver(token, observer);
      };
    });
  }

  private connectIfNeeded(): void {
    if (typeof WebSocket === "undefined") {
      throw new Error("WebSocket is not available in this environment.");
    }

    if (
      this.socket &&
      (this.socket.readyState === WebSocket.OPEN ||
        this.socket.readyState === WebSocket.CONNECTING)
    ) {
      return;
    }

    this.socket = new WebSocket(this.wsUrlWithVsn());
    this.socket.onopen = () => {
      this.startHeartbeat();
      for (const token of this.pendingTokens) {
        this.sendJoin(token);
      }
      this.pendingTokens.clear();
    };
    this.socket.onmessage = (event) => {
      this.handleMessage(event.data);
    };
    this.socket.onerror = () => {
      this.failAll(new Error("WebSocket connection error."));
    };
    this.socket.onclose = () => {
      this.failAll(new Error("WebSocket connection closed."));
      this.stopHeartbeat();
      this.joinedTokens.clear();
      this.socket = undefined;
    };
  }

  private wsUrlWithVsn(): string {
    try {
      const url = new URL(this.wsUrl);
      if (!url.searchParams.has("vsn")) {
        url.searchParams.set("vsn", "2.0.0");
      }
      return url.toString();
    } catch {
      const separator = this.wsUrl.includes("?") ? "&" : "?";
      return `${this.wsUrl}${separator}vsn=2.0.0`;
    }
  }

  private handleMessage(data: unknown): void {
    let message: PhoenixMessage;
    try {
      message =
        typeof data === "string"
          ? (JSON.parse(data) as PhoenixMessage)
          : (data as PhoenixMessage);
    } catch {
      return;
    }

    if (!Array.isArray(message) || message.length !== 5) {
      return;
    }

    const [, , topic, event, payload] = message;

    if (event === "phx_reply") {
      this.handlePhoenixReply(topic, payload);
      return;
    }

    const token = this.tokenFromTopic(topic);
    if (!token) {
      return;
    }

    const subscription = this.subscriptions.get(token);
    if (!subscription) {
      return;
    }

    if (event === "agui_complete") {
      this.completeToken(token);
      return;
    }

    if (event !== "agui_event") {
      return;
    }

    let parsedEvent: BaseEvent;
    try {
      parsedEvent = EventSchemas.parse(payload);
    } catch (error) {
      this.emitError(token, this.toError(error, "Invalid AG-UI event payload."));
      return;
    }

    this.nextTokenEvent(token, parsedEvent);
    if (
      parsedEvent.type === EventType.RUN_FINISHED ||
      parsedEvent.type === EventType.RUN_ERROR
    ) {
      this.completeToken(token);
    }
  }

  private failAll(error: Error): void {
    for (const [token] of this.subscriptions) {
      this.emitError(token, error);
    }
    this.stopHeartbeat();
  }

  private emitError(token: string, error: Error): void {
    const subscription = this.subscriptions.get(token);
    if (!subscription) {
      return;
    }

    for (const observer of subscription.observers) {
      observer.error(error);
    }
    this.clearSubscription(token);
  }

  private completeToken(token: string): void {
    const subscription = this.subscriptions.get(token);
    if (!subscription) {
      return;
    }

    for (const observer of subscription.observers) {
      observer.complete();
    }
    this.clearSubscription(token);
  }

  private getOrCreateSubscription(token: string): TokenSubscription {
    const existing = this.subscriptions.get(token);
    if (existing) {
      return existing;
    }

    const created: TokenSubscription = {
      observerCount: 0,
      observers: new Set(),
    };
    this.subscriptions.set(token, created);
    return created;
  }

  private subscribeToken(token: string): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      this.pendingTokens.add(token);
      return;
    }
    this.sendJoin(token);
  }

  private sendJoin(token: string): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      this.pendingTokens.add(token);
      return;
    }

    if (this.joinedTokens.has(token)) {
      return;
    }

    const message: PhoenixMessage = [
      this.nextJoinRef(),
      this.nextRef(),
      this.topicForToken(token),
      "phx_join",
      { token },
    ];
    this.socket.send(JSON.stringify(message));
    this.joinedTokens.add(token);
  }

  private removeObserver(
    token: string,
    observer: TokenSubscription["observers"] extends Set<infer T> ? T : never,
  ): void {
    const subscription = this.subscriptions.get(token);
    if (!subscription) {
      return;
    }

    subscription.observers.delete(observer);
    subscription.observerCount = Math.max(subscription.observerCount - 1, 0);
    if (subscription.observerCount === 0) {
      this.clearSubscription(token);
    }
  }

  private clearSubscription(token: string): void {
    const subscription = this.subscriptions.get(token);
    if (!subscription) {
      return;
    }

    this.sendLeave(token);
    this.subscriptions.delete(token);
    this.pendingTokens.delete(token);
    this.joinedTokens.delete(token);

    if (this.subscriptions.size === 0 && this.socket) {
      this.socket.close();
      this.socket = undefined;
    }

    if (this.subscriptions.size === 0 && !this.socket) {
      this.onIdle?.();
    }
  }

  private sendLeave(token: string): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      return;
    }

    const message: PhoenixMessage = [
      null,
      this.nextRef(),
      this.topicForToken(token),
      "phx_leave",
      {},
    ];
    this.socket.send(JSON.stringify(message));
  }

  private topicForToken(token: string): string {
    return `thread:${token}`;
  }

  private tokenFromTopic(topic: string): string | null {
    if (!topic.startsWith("thread:")) {
      return null;
    }
    return topic.slice("thread:".length);
  }

  private nextRef(): string {
    this.refCounter += 1;
    return String(this.refCounter);
  }

  private nextJoinRef(): string {
    this.joinRefCounter += 1;
    return String(this.joinRefCounter);
  }

  private nextTokenEvent(token: string, event: BaseEvent): void {
    const subscription = this.subscriptions.get(token);
    if (!subscription) {
      return;
    }
    for (const observer of subscription.observers) {
      observer.next(event);
    }
  }

  private handlePhoenixReply(topic: string, payload: unknown): void {
    const token = this.tokenFromTopic(topic);
    if (!token || typeof payload !== "object" || payload === null) {
      return;
    }

    const status =
      "status" in payload && typeof payload.status === "string"
        ? payload.status
        : "";
    if (status === "ok") {
      return;
    }

    const reason =
      "response" in payload &&
      typeof payload.response === "object" &&
      payload.response !== null &&
      "reason" in payload.response &&
      typeof payload.response.reason === "string"
        ? payload.response.reason
        : "phoenix_join_failed";
    this.emitError(token, new Error(reason));
  }

  private toError(error: unknown, fallback: string): Error {
    return error instanceof Error ? error : new Error(fallback);
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeatHandle = setInterval(() => {
      if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
        return;
      }
      const message: PhoenixMessage = [
        null,
        this.nextRef(),
        "phoenix",
        "heartbeat",
        {},
      ];
      this.socket.send(JSON.stringify(message));
    }, 30_000);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatHandle) {
      clearInterval(this.heartbeatHandle);
      this.heartbeatHandle = undefined;
    }
  }
}

const websocketSessionManagers = new Map<string, WebSocketSessionManager>();

function getWebSocketSessionManager(wsUrl: string): WebSocketSessionManager {
  const existing = websocketSessionManagers.get(wsUrl);
  if (existing) {
    return existing;
  }

  const manager = new WebSocketSessionManager(wsUrl, () => {
    websocketSessionManagers.delete(wsUrl);
  });
  websocketSessionManagers.set(wsUrl, manager);
  return manager;
}

export interface ProxiedCopilotRuntimeAgentConfig extends Omit<
  HttpAgentConfig,
  "url"
> {
  runtimeUrl?: string;
  transport?: CopilotRuntimeTransport;
  credentials?: RequestCredentials;
}

export class ProxiedCopilotRuntimeAgent extends HttpAgent {
  runtimeUrl?: string;
  credentials?: RequestCredentials;
  private transport: CopilotRuntimeTransport;
  private singleEndpointUrl?: string;

  constructor(config: ProxiedCopilotRuntimeAgentConfig) {
    const normalizedRuntimeUrl = config.runtimeUrl
      ? config.runtimeUrl.replace(/\/$/, "")
      : undefined;
    const transport = config.transport ?? "rest";
    const runUrl =
      transport === "single"
        ? (normalizedRuntimeUrl ?? config.runtimeUrl ?? "")
        : `${normalizedRuntimeUrl ?? config.runtimeUrl}/agent/${encodeURIComponent(config.agentId ?? "")}/run`;

    if (!runUrl) {
      throw new Error(
        "ProxiedCopilotRuntimeAgent requires a runtimeUrl when transport is set to 'single'.",
      );
    }

    super({
      ...config,
      url: runUrl,
    });
    this.runtimeUrl = normalizedRuntimeUrl ?? config.runtimeUrl;
    this.credentials = config.credentials;
    this.transport = transport;
    if (this.transport === "single") {
      this.singleEndpointUrl = this.runtimeUrl;
    }
  }

  abortRun(): void {
    if (!this.agentId || !this.threadId) {
      return;
    }

    if (typeof fetch === "undefined") {
      return;
    }

    if (this.transport === "single") {
      if (!this.singleEndpointUrl) {
        return;
      }

      const headers = new Headers({
        ...this.headers,
        "Content-Type": "application/json",
      });
      void fetch(this.singleEndpointUrl, {
        method: "POST",
        headers,
        body: JSON.stringify({
          method: "agent/stop",
          params: {
            agentId: this.agentId,
            threadId: this.threadId,
          },
        }),
        ...(this.credentials ? { credentials: this.credentials } : {}),
      }).catch((error) => {
        console.error("ProxiedCopilotRuntimeAgent: stop request failed", error);
      });
      return;
    }

    if (!this.runtimeUrl) {
      return;
    }

    const stopPath = `${this.runtimeUrl}/agent/${encodeURIComponent(this.agentId)}/stop/${encodeURIComponent(this.threadId)}`;
    const origin =
      typeof window !== "undefined" && window.location
        ? window.location.origin
        : "http://localhost";
    const base = new URL(this.runtimeUrl, origin);
    const stopUrl = new URL(stopPath, base);

    void fetch(stopUrl.toString(), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...this.headers,
      },
      ...(this.credentials ? { credentials: this.credentials } : {}),
    }).catch((error) => {
      console.error("ProxiedCopilotRuntimeAgent: stop request failed", error);
    });
  }

  connect(input: RunAgentInput): Observable<BaseEvent> {
    if (this.transport === "single") {
      if (!this.singleEndpointUrl) {
        throw new Error("Single endpoint transport requires a runtimeUrl");
      }

      const requestInit = this.createSingleRouteRequestInit(
        input,
        "agent/connect",
        {
          agentId: this.agentId!,
        },
      );
      const httpEvents = runHttpRequest(this.singleEndpointUrl, requestInit);
      return withAbortErrorHandling(transformHttpEventStream(httpEvents));
    }

    const httpEvents = runHttpRequest(
      `${this.runtimeUrl}/agent/${this.agentId}/connect`,
      this.requestInit(input),
    );
    return withAbortErrorHandling(transformHttpEventStream(httpEvents));
  }

  public run(input: RunAgentInput): Observable<BaseEvent> {
    if (this.transport === "single") {
      if (!this.singleEndpointUrl) {
        throw new Error("Single endpoint transport requires a runtimeUrl");
      }

      const requestInit = this.createSingleRouteRequestInit(
        input,
        "agent/run",
        {
          agentId: this.agentId!,
        },
      );
      const httpEvents = runHttpRequest(this.singleEndpointUrl, requestInit);
      return withAbortErrorHandling(transformHttpEventStream(httpEvents));
    }

    // Wrap the parent's Observable with error handling for abort scenarios
    return withAbortErrorHandling(super.run(input));
  }

  public override clone(): ProxiedCopilotRuntimeAgent {
    const cloned = super.clone() as ProxiedCopilotRuntimeAgent;
    cloned.runtimeUrl = this.runtimeUrl;
    cloned.credentials = this.credentials;
    cloned.transport = this.transport;
    cloned.singleEndpointUrl = this.singleEndpointUrl;
    return cloned;
  }

  private createSingleRouteRequestInit(
    input: RunAgentInput,
    method: string,
    params?: Record<string, string>,
  ): RequestInit {
    if (!this.agentId) {
      throw new Error(
        "ProxiedCopilotRuntimeAgent requires agentId to make runtime requests",
      );
    }

    const baseInit = super.requestInit(input);
    const headers = new Headers(baseInit.headers ?? {});
    headers.set("Content-Type", "application/json");
    headers.set("Accept", headers.get("Accept") ?? "text/event-stream");

    let originalBody: unknown = undefined;
    if (typeof baseInit.body === "string") {
      try {
        originalBody = JSON.parse(baseInit.body);
      } catch (error) {
        console.warn(
          "ProxiedCopilotRuntimeAgent: failed to parse request body for single route transport",
          error,
        );
        originalBody = undefined;
      }
    }

    const envelope: Record<string, unknown> = {
      method,
    };

    if (params && Object.keys(params).length > 0) {
      envelope.params = params;
    }

    if (originalBody !== undefined) {
      envelope.body = originalBody;
    }

    return {
      ...baseInit,
      headers,
      body: JSON.stringify(envelope),
      ...(this.credentials ? { credentials: this.credentials } : {}),
    };
  }
}

export class WebSocketAgent extends AbstractAgent {
  readonly restUrl: string;
  readonly wsUrl: string;
  readonly credentials?: RequestCredentials;
  readonly headers: Record<string, string>;

  constructor(config: WebSocketAgentConfig) {
    super({
      agentId: config.agentId,
      threadId: config.threadId,
      description: config.description,
      initialMessages: config.initialMessages,
      initialState: config.initialState,
      debug: config.debug,
    });
    this.restUrl = config.restUrl.replace(/\/$/, "");
    this.wsUrl = config.wsUrl;
    this.credentials = config.credentials;
    this.headers = { ...(config.headers ?? {}) };
  }

  run(input: RunAgentInput): Observable<BaseEvent> {
    return this.startWebSocketFlow("run-ws", input);
  }

  protected connect(input: RunAgentInput): Observable<BaseEvent> {
    return this.startWebSocketFlow("connect-ws", input);
  }

  abortRun(): void {
    if (!this.agentId || !this.threadId || typeof fetch === "undefined") {
      return;
    }

    const stopUrl = `${this.restUrl}/agent/${encodeURIComponent(this.agentId)}/stop/${encodeURIComponent(this.threadId)}`;
    void fetch(stopUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...this.headers,
      },
      ...(this.credentials ? { credentials: this.credentials } : {}),
    }).catch((error) => {
      console.error("WebSocketAgent: stop request failed", error);
    });
  }

  override clone(): WebSocketAgent {
    const cloned = new WebSocketAgent({
      restUrl: this.restUrl,
      wsUrl: this.wsUrl,
      agentId: this.agentId ?? "",
      headers: { ...this.headers },
      credentials: this.credentials,
      threadId: this.threadId,
      description: this.description,
      initialMessages: this.messages,
      initialState: this.state,
      debug: this.debug,
    });
    cloned.subscribers = [...this.subscribers];
    return cloned;
  }

  private startWebSocketFlow(
    endpointName: "run-ws" | "connect-ws",
    input: RunAgentInput,
  ): Observable<BaseEvent> {
    return new Observable<BaseEvent>((subscriber) => {
      const abortController = new AbortController();
      let wsSubscription: ReturnType<Observable<BaseEvent>["subscribe"]> | null =
        null;

      this.exchangeToken(endpointName, input, abortController.signal)
        .then((tokenResponse) => {
          this.threadId = tokenResponse.threadId;
          const targetWsUrl = tokenResponse.wsUrl ?? this.wsUrl;
          if (!targetWsUrl) {
            throw new Error(
              "WebSocketAgent requires wsUrl in config or token response.",
            );
          }

          wsSubscription = getWebSocketSessionManager(targetWsUrl)
            .subscribe(tokenResponse.token)
            .subscribe(subscriber);
        })
        .catch((error) => {
          subscriber.error(error);
        });

      return () => {
        abortController.abort();
        wsSubscription?.unsubscribe();
      };
    });
  }

  private async exchangeToken(
    endpointName: "run-ws" | "connect-ws",
    input: RunAgentInput,
    signal: AbortSignal,
  ): Promise<WebSocketTokenResponse> {
    if (!this.agentId) {
      throw new Error("WebSocketAgent requires agentId.");
    }

    if (typeof fetch === "undefined") {
      throw new Error("fetch is not available in this environment.");
    }

    const endpointUrl = `${this.restUrl}/agent/${encodeURIComponent(this.agentId)}/${endpointName}`;
    const response = await fetch(endpointUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        ...this.headers,
      },
      body: JSON.stringify(input),
      signal,
      ...(this.credentials ? { credentials: this.credentials } : {}),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(
        `WebSocketAgent token request failed (${response.status}): ${body}`,
      );
    }

    const tokenPayload = (await response.json()) as WebSocketTokenResponse;
    if (
      !tokenPayload ||
      typeof tokenPayload.token !== "string" ||
      typeof tokenPayload.expiresInSeconds !== "number" ||
      typeof tokenPayload.threadId !== "string"
    ) {
      throw new Error("Invalid token response payload from runtime.");
    }

    return tokenPayload;
  }
}
