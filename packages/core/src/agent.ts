import {
  AbstractAgent,
  AgentSubscriber,
  BaseEvent,
  HttpAgent,
  HttpAgentConfig,
  RunAgentInput,
  RunAgentParameters,
  RunAgentResult,
  runHttpRequest,
  transformHttpEventStream,
} from "@ag-ui/client";
import type { AgentCapabilities } from "@ag-ui/core";
import { Observable, EMPTY, defer, from } from "rxjs";
import { catchError, switchMap } from "rxjs/operators";
import {
  RUNTIME_MODE_SSE,
  RUNTIME_MODE_INTELLIGENCE,
  type IntelligenceRuntimeInfo,
  type RuntimeInfo,
  type RuntimeMode,
  type ResolvedDebugConfig,
} from "@copilotkit/shared";
import { IntelligenceAgent } from "./intelligence-agent";
import { CopilotRuntimeTransport } from "./types";

type ResolvedRuntimeMode = RuntimeMode | "pending";

interface RunnableAgent {
  connect(input: RunAgentInput): Observable<BaseEvent>;
  run(input: RunAgentInput): Observable<BaseEvent>;
}

function hasHeaders(
  agent: AbstractAgent,
): agent is AbstractAgent & { headers?: Record<string, string> } {
  return "headers" in agent;
}

function hasCredentials(
  agent: AbstractAgent,
): agent is AbstractAgent & { credentials?: RequestCredentials } {
  return "credentials" in agent;
}

function isZodError(error: unknown): boolean {
  return (
    error !== null &&
    typeof error === "object" &&
    "name" in error &&
    (error as { name: string }).name === "ZodError"
  );
}

function isAbortError(error: unknown): boolean {
  return (
    (error instanceof DOMException || error instanceof Error) &&
    (error as Error).name === "AbortError"
  );
}

function withAbortErrorHandling(
  observable: Observable<BaseEvent>,
): Observable<BaseEvent> {
  return observable.pipe(
    catchError((error) => {
      if (isZodError(error) || isAbortError(error)) {
        return EMPTY;
      }
      throw error;
    }),
  );
}

export interface ProxiedCopilotRuntimeAgentConfig extends Omit<
  HttpAgentConfig,
  "url"
> {
  runtimeUrl?: string;
  transport?: CopilotRuntimeTransport;
  credentials?: RequestCredentials;
  runtimeMode?: ResolvedRuntimeMode;
  intelligence?: IntelligenceRuntimeInfo;
  capabilities?: AgentCapabilities;
  debug?: ResolvedDebugConfig;
}

export class ProxiedCopilotRuntimeAgent extends HttpAgent {
  runtimeUrl?: string;
  credentials?: RequestCredentials;
  private transport: CopilotRuntimeTransport;
  private singleEndpointUrl?: string;
  private runtimeMode: ResolvedRuntimeMode;
  private intelligence?: IntelligenceRuntimeInfo;
  private _capabilities?: AgentCapabilities;
  private delegate?: AbstractAgent;
  private runtimeInfoPromise?: Promise<void>;

  constructor(config: ProxiedCopilotRuntimeAgentConfig) {
    const normalizedRuntimeUrl = config.runtimeUrl
      ? config.runtimeUrl.replace(/\/$/, "")
      : undefined;
    const transport = config.transport ?? "auto";
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
    this.runtimeMode = config.runtimeMode ?? RUNTIME_MODE_SSE;
    this.intelligence = config.intelligence;
    this._capabilities = config.capabilities;
    if (config.debug) {
      this.debug = config.debug;
    }
    if (this.transport === "single") {
      this.singleEndpointUrl = this.runtimeUrl;
    }
  }

  override requestInit(input: RunAgentInput): RequestInit {
    const baseInit = super.requestInit(input);
    return {
      ...baseInit,
      ...(this.credentials ? { credentials: this.credentials } : {}),
    };
  }

  get capabilities(): AgentCapabilities | undefined {
    return this._capabilities;
  }

  async getCapabilities(): Promise<AgentCapabilities> {
    return this._capabilities ?? {};
  }

  override async detachActiveRun(): Promise<void> {
    if (this.delegate) {
      await this.delegate.detachActiveRun();
    }
    await super.detachActiveRun();
  }

  abortRun(): void {
    if (this.delegate) {
      this.syncDelegate(this.delegate);
      this.delegate.abortRun();
      // Also detach the proxy's own runAgent pipeline so the proxy's
      // isRunning resets and onRunFinalized fires even if the delegate's
      // observable doesn't propagate a clean completion.
      void this.detachActiveRun();
      return;
    }

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

  override async connectAgent(
    parameters?: RunAgentParameters,
    subscriber?: AgentSubscriber,
  ): Promise<RunAgentResult> {
    if (this.runtimeMode !== RUNTIME_MODE_INTELLIGENCE) {
      return super.connectAgent(parameters, subscriber);
    }

    // If the delegate already has an active run (e.g. from a previous
    // connectAgent call that hasn't finished yet), detach it first.  This
    // ensures only one run is active on the delegate at a time — without it,
    // two parallel runs would both pump events into the shared delegate,
    // and both bridge subscriptions would copy the interleaved messages to
    // the proxy, causing the UI to flicker between the two conversations.
    if (this.delegate) {
      await this.delegate.detachActiveRun();
    }

    // Ensure the delegate exists and is synced with the proxy's current state.
    await this.resolveDelegate();
    const delegate = this.delegate!;

    // Subscribe a bridging observer FIRST so it fires before the forwarded
    // UI subscribers.  This keeps proxy.messages in sync with the delegate
    // in real-time — otherwise the UI re-renders (triggered by the
    // forwarded onMessagesChanged) but reads stale proxy.messages because
    // the final sync only happens after connectAgent resolves.
    const bridgeSub = delegate.subscribe({
      onMessagesChanged: () => {
        this.setMessages([...delegate.messages]);
      },
      onStateChanged: () => {
        this.setState({ ...delegate.state });
      },
      // Mirror isRunning so the proxy reflects the delegate's run lifecycle.
      // Without this, UI components read proxy.isRunning (always false) even
      // though the delegate is actively running, causing the stop button to
      // never appear.
      onRunInitialized: () => {
        this.isRunning = true;
      },
      onRunFinalized: () => {
        this.isRunning = false;
      },
      // Local exception (network error, deserialization failure, etc.)
      onRunFailed: () => {
        this.isRunning = false;
      },
      // Protocol-level RUN_ERROR event from the backend
      onRunErrorEvent: () => {
        this.isRunning = false;
      },
    });

    // Forward the proxy's subscribers to the delegate so that UI hooks
    // (e.g. useAgent's onMessagesChanged) receive real-time updates as
    // the delegate processes events during connectAgent.
    const forwardedSubs = this.subscribers.map((s) => delegate.subscribe(s));

    try {
      const result = await delegate.connectAgent(parameters, subscriber);

      // Final sync to guarantee the proxy reflects the delegate's end state.
      this.setMessages([...delegate.messages]);
      this.setState({ ...delegate.state });

      return result;
    } finally {
      // Ensure the proxy's isRunning is reset — the bridging subscription
      // may have already handled this, but if the delegate threw before
      // firing onRunFinalized the proxy would be stuck in isRunning=true.
      this.isRunning = false;
      // Remove forwarded subscribers to avoid duplicate notifications on
      // subsequent calls (they'll be re-forwarded next time).
      bridgeSub.unsubscribe();
      for (const sub of forwardedSubs) {
        sub.unsubscribe();
      }
    }
  }

  connect(input: RunAgentInput): Observable<BaseEvent> {
    if (this.runtimeMode === RUNTIME_MODE_INTELLIGENCE) {
      return this.#connectViaDelegate(input);
    }
    return this.#connectViaHttp(input);
  }

  public run(input: RunAgentInput): Observable<BaseEvent> {
    if (this.runtimeMode === RUNTIME_MODE_INTELLIGENCE) {
      return this.#runViaDelegate(input);
    }
    return this.#runViaHttp(input);
  }

  #connectViaDelegate(input: RunAgentInput): Observable<BaseEvent> {
    return defer(() => from(this.resolveDelegate())).pipe(
      switchMap((delegate) => withAbortErrorHandling(delegate.connect(input))),
    );
  }

  #connectViaHttp(input: RunAgentInput): Observable<BaseEvent> {
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

  #runViaDelegate(input: RunAgentInput): Observable<BaseEvent> {
    return defer(() => from(this.resolveDelegate())).pipe(
      switchMap((delegate) => withAbortErrorHandling(delegate.run(input))),
    );
  }

  #runViaHttp(input: RunAgentInput): Observable<BaseEvent> {
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

    return withAbortErrorHandling(super.run(input));
  }

  public override clone(): ProxiedCopilotRuntimeAgent {
    const cloned = new ProxiedCopilotRuntimeAgent({
      runtimeUrl: this.runtimeUrl,
      agentId: this.agentId,
      description: this.description,
      headers: { ...this.headers },
      credentials: this.credentials,
      transport: this.transport,
      runtimeMode: this.runtimeMode,
      intelligence: this.intelligence,
      capabilities: this._capabilities,
      debug: this.debug,
    });
    cloned.threadId = this.threadId;
    cloned.setState(this.state);
    cloned.setMessages(this.messages);
    if (this.delegate) {
      cloned.delegate = this.delegate.clone();
      cloned.syncDelegate(cloned.delegate);
    }
    return cloned;
  }

  private async resolveDelegate(): Promise<RunnableAgent> {
    await this.ensureRuntimeMode();

    if (!this.delegate) {
      if (this.runtimeMode !== RUNTIME_MODE_INTELLIGENCE) {
        throw new Error("A delegate is only created for Intelligence mode");
      }
      this.delegate = this.createIntelligenceDelegate();
    }

    this.syncDelegate(this.delegate);

    // AbstractAgent declares connect() as protected, but concrete delegates
    // (IntelligenceAgent, HttpAgent) expose both connect() and run() publicly.
    return this.delegate as unknown as RunnableAgent;
  }

  private async ensureRuntimeMode(): Promise<void> {
    if (this.runtimeMode !== "pending") {
      return;
    }

    if (!this.runtimeUrl) {
      throw new Error("Runtime URL is not set");
    }

    this.runtimeInfoPromise ??= this.fetchRuntimeInfo().then((runtimeInfo) => {
      this.runtimeMode = runtimeInfo.mode ?? RUNTIME_MODE_SSE;
      this.intelligence = runtimeInfo.intelligence;
    });

    await this.runtimeInfoPromise;
  }

  private async fetchRuntimeInfo(): Promise<RuntimeInfo> {
    const headers: Record<string, string> = {
      ...this.headers,
    };

    if (this.transport === "auto") {
      return this.fetchRuntimeInfoAutoDetect(headers);
    }

    let init: RequestInit;
    let url: string;

    if (this.transport === "single") {
      if (!this.singleEndpointUrl) {
        throw new Error("Single endpoint transport requires a runtimeUrl");
      }
      if (!headers["Content-Type"]) {
        headers["Content-Type"] = "application/json";
      }
      url = this.runtimeUrl!;
      init = { method: "POST", body: JSON.stringify({ method: "info" }) };
    } else {
      url = `${this.runtimeUrl}/info`;
      init = {};
    }

    const response = await fetch(url, {
      ...init,
      headers,
      ...(this.credentials ? { credentials: this.credentials } : {}),
    });
    if (!response.ok) {
      throw new Error(
        `Runtime info request failed with status ${response.status}`,
      );
    }
    return (await response.json()) as RuntimeInfo;
  }

  private async fetchRuntimeInfoAutoDetect(
    headers: Record<string, string>,
  ): Promise<RuntimeInfo> {
    // Try REST first (GET /info)
    try {
      const response = await fetch(`${this.runtimeUrl}/info`, {
        headers: { ...headers },
        ...(this.credentials ? { credentials: this.credentials } : {}),
      });
      // Only treat a successful (2xx) response as a valid REST runtime.
      // 404/405 means the endpoint doesn't exist; other non-2xx errors
      // (500, 403, etc.) should also fall through to single-endpoint.
      if (response.status >= 200 && response.status < 300) {
        this.transport = "rest";
        return (await response.json()) as RuntimeInfo;
      }
    } catch {
      // REST failed — fall through to single-endpoint attempt
    }

    // Try single-endpoint (POST with { method: "info" })
    const singleHeaders = { ...headers };
    if (!singleHeaders["Content-Type"]) {
      singleHeaders["Content-Type"] = "application/json";
    }
    const response = await fetch(this.runtimeUrl!, {
      method: "POST",
      headers: singleHeaders,
      body: JSON.stringify({ method: "info" }),
      ...(this.credentials ? { credentials: this.credentials } : {}),
    });
    if (!response.ok) {
      throw new Error(
        `Runtime info request failed with status ${response.status}`,
      );
    }
    this.transport = "single";
    this.singleEndpointUrl = this.runtimeUrl;
    return (await response.json()) as RuntimeInfo;
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
      }
    }

    const envelope: Record<string, unknown> = { method };

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

  private createIntelligenceDelegate(): AbstractAgent {
    if (!this.runtimeUrl || !this.agentId || !this.intelligence?.wsUrl) {
      throw new Error(
        "Intelligence mode requires runtimeUrl, agentId, and intelligence websocket metadata",
      );
    }

    return new IntelligenceAgent({
      url: this.intelligence.wsUrl,
      runtimeUrl: this.runtimeUrl,
      agentId: this.agentId,
      headers: { ...this.headers },
      credentials: this.credentials,
    });
  }

  private syncDelegate(delegate: AbstractAgent): void {
    delegate.agentId = this.agentId;
    delegate.description = this.description;
    delegate.threadId = this.threadId;
    delegate.setMessages(this.messages);
    delegate.setState(this.state);

    if (hasHeaders(delegate)) {
      delegate.headers = { ...this.headers };
    }

    if (hasCredentials(delegate)) {
      delegate.credentials = this.credentials;
    }
  }
}
