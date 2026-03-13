import {
  BaseEvent,
  HttpAgent,
  HttpAgentConfig,
  RunAgentInput,
  runHttpRequest,
  transformHttpEventStream,
} from "@ag-ui/client";
import { Observable, EMPTY } from "rxjs";
import { catchError } from "rxjs/operators";
import { CopilotRuntimeTransport } from "./types";

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
