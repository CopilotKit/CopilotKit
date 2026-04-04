import {
  BaseEvent,
  HttpAgent,
  HttpAgentConfig,
  RunAgentInput,
  runHttpRequest,
  transformHttpEventStream,
} from "@ag-ui/client";
import { Observable, EMPTY, throwError, timer } from "rxjs";
import { catchError, retry, mergeMap } from "rxjs/operators";
import { CopilotRuntimeTransport } from "./types";

/**
 * Retry configuration for resilient connections
 * Issue #3300: Add connection resilience with retry logic
 */
export interface RetryConfig {
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs: number;
  retryableStatuses: number[];
}

const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: 3,
  baseDelayMs: 1000,
  maxDelayMs: 10000,
  retryableStatuses: [408, 429, 500, 502, 503, 504],
};

/**
 * Calculate exponential backoff delay with jitter
 */
function getExponentialBackoffDelay(
  attempt: number,
  config: RetryConfig
): number {
  const exponentialDelay = config.baseDelayMs * Math.pow(2, attempt - 1);
  const cappedDelay = Math.min(exponentialDelay, config.maxDelayMs);
  const jitter = Math.random() * 0.3 * cappedDelay; // 30% jitter
  return Math.min(cappedDelay + jitter, config.maxDelayMs);
}

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
 * Check if an error is retryable based on status code
 */
function isRetryableError(error: unknown, config: RetryConfig): boolean {
  if (error && typeof error === "object") {
    const status = (error as { status?: number }).status;
    if (status && config.retryableStatuses.includes(status)) {
      return true;
    }
    // Network errors (no status) are retryable
    if ((error as { message?: string }).message?.includes("fetch")) {
      return true;
    }
  }
  return false;
}

/**
 * Wrap an Observable with retry logic and abort error handling
 * Issue #3300: Add connection resilience with exponential backoff retry
 */
function withResilientErrorHandling(
  observable: Observable<BaseEvent>,
  retryConfig: RetryConfig = DEFAULT_RETRY_CONFIG,
  operationName: string = "request"
): Observable<BaseEvent> {
  let attempt = 0;
  
  return observable.pipe(
    catchError((error) => {
      // Don't retry ZodErrors - these are from stream aborts
      if (isZodError(error)) {
        return EMPTY;
      }
      return throwError(() => error);
    }),
    retry({
      count: retryConfig.maxRetries,
      delay: (error) => {
        attempt++;
        if (!isRetryableError(error, retryConfig)) {
          return throwError(() => error);
        }
        const delayMs = getExponentialBackoffDelay(attempt, retryConfig);
        console.warn(
          `[CopilotKit] ${operationName} failed (attempt ${attempt}/${retryConfig.maxRetries}), retrying in ${Math.round(delayMs)}ms...`
        );
        return timer(delayMs);
      },
    }),
    catchError((error) => {
      console.error(
        `[CopilotKit] ${operationName} failed after ${retryConfig.maxRetries} attempts:`,
        error
      );
      return throwError(() => error);
    })
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
      return withResilientErrorHandling(transformHttpEventStream(httpEvents), DEFAULT_RETRY_CONFIG, "connect");
    }

    const httpEvents = runHttpRequest(
      `${this.runtimeUrl}/agent/${this.agentId}/connect`,
      this.requestInit(input),
    );
    return withResilientErrorHandling(transformHttpEventStream(httpEvents), DEFAULT_RETRY_CONFIG, "connect");
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
      return withResilientErrorHandling(transformHttpEventStream(httpEvents), DEFAULT_RETRY_CONFIG, "run");
    }

    // Wrap the parent's Observable with resilient error handling for abort scenarios
    return withResilientErrorHandling(super.run(input), DEFAULT_RETRY_CONFIG, "run");
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
