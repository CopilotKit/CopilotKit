import {
  AbstractAgent,
  BaseEvent,
  HttpAgent,
  HttpAgentConfig,
  RunAgentInput,
  runHttpRequest,
  transformHttpEventStream,
} from "@ag-ui/client";
import { Observable, EMPTY, defer, from } from "rxjs";
import { catchError, switchMap } from "rxjs/operators";
import type {
  IntelligenceRuntimeInfo,
  RuntimeInfo,
  RuntimeMode,
} from "@copilotkitnext/shared";
import { IntelligenceAgent } from "./intelligence-agent";
import { CopilotRuntimeTransport } from "./types";

type ResolvedRuntimeMode = RuntimeMode | "pending";

function isZodError(error: unknown): boolean {
  return (
    error !== null &&
    typeof error === "object" &&
    "name" in error &&
    (error as { name: string }).name === "ZodError"
  );
}

function withAbortErrorHandling(
  observable: Observable<BaseEvent>,
): Observable<BaseEvent> {
  return observable.pipe(
    catchError((error) => {
      if (isZodError(error)) {
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
}

export class ProxiedCopilotRuntimeAgent extends HttpAgent {
  runtimeUrl?: string;
  credentials?: RequestCredentials;
  private transport: CopilotRuntimeTransport;
  private singleEndpointUrl?: string;
  private runtimeMode: ResolvedRuntimeMode;
  private intelligence?: IntelligenceRuntimeInfo;
  private delegate?: AbstractAgent;
  private runtimeInfoPromise?: Promise<void>;

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
    this.runtimeMode = config.runtimeMode ?? "sse";
    this.intelligence = config.intelligence;
    if (this.transport === "single") {
      this.singleEndpointUrl = this.runtimeUrl;
    }
  }

  abortRun(): void {
    if (this.delegate) {
      this.syncDelegate(this.delegate);
      this.delegate.abortRun();
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

  connect(input: RunAgentInput): Observable<BaseEvent> {
    if (this.runtimeMode !== "intelligence") {
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

    return defer(() => from(this.resolveDelegate())).pipe(
      switchMap((delegate) =>
        withAbortErrorHandling(
          (delegate as AbstractAgent & {
            connect: (input: RunAgentInput) => Observable<BaseEvent>;
          }).connect(input),
        ),
      ),
    );
  }

  public run(input: RunAgentInput): Observable<BaseEvent> {
    if (this.runtimeMode !== "intelligence") {
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

    return defer(() => from(this.resolveDelegate())).pipe(
      switchMap((delegate) =>
        withAbortErrorHandling(
          (delegate as AbstractAgent & {
            run: (input: RunAgentInput) => Observable<BaseEvent>;
          }).run(input),
        ),
      ),
    );
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

  private async resolveDelegate(): Promise<AbstractAgent> {
    await this.ensureRuntimeMode();

    if (this.delegate) {
      this.syncDelegate(this.delegate);
      return this.delegate;
    }

    if (this.runtimeMode !== "intelligence") {
      throw new Error("A delegate is only created for Intelligence mode");
    }

    this.delegate = this.createIntelligenceDelegate();
    this.syncDelegate(this.delegate);
    return this.delegate;
  }

  private async ensureRuntimeMode(): Promise<void> {
    if (this.runtimeMode !== "pending") {
      return;
    }

    if (!this.runtimeUrl) {
      throw new Error("Runtime URL is not set");
    }

    this.runtimeInfoPromise ??= this.fetchRuntimeInfo().then((runtimeInfo) => {
      this.runtimeMode = runtimeInfo.mode ?? "sse";
      this.intelligence = runtimeInfo.intelligence;
    });

    await this.runtimeInfoPromise;
  }

  private async fetchRuntimeInfo(): Promise<RuntimeInfo> {
    const headers: Record<string, string> = {
      ...this.headers,
    };

    if (this.transport === "single") {
      if (!this.singleEndpointUrl) {
        throw new Error("Single endpoint transport requires a runtimeUrl");
      }
      if (!headers["Content-Type"]) {
        headers["Content-Type"] = "application/json";
      }
      const response = await fetch(this.runtimeUrl!, {
        method: "POST",
        headers,
        body: JSON.stringify({ method: "info" }),
        ...(this.credentials ? { credentials: this.credentials } : {}),
      });
      if (!response.ok) {
        throw new Error(
          `Runtime info request failed with status ${response.status}`,
        );
      }
      return (await response.json()) as RuntimeInfo;
    }

    const response = await fetch(`${this.runtimeUrl}/info`, {
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

    if ("headers" in delegate) {
      (delegate as AbstractAgent & { headers?: Record<string, string> }).headers =
        {
          ...this.headers,
        };
    }

    if ("credentials" in delegate) {
      (
        delegate as AbstractAgent & {
          credentials?: RequestCredentials;
        }
      ).credentials = this.credentials;
    }
  }
}
