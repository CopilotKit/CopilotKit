import type { BaseEvent } from "@ag-ui/client";
import { EventEncoder } from "@ag-ui/encoder";
import type { Observable, Subscription } from "rxjs";
import {
  keepAliveSse,
  resolveSseKeepAliveIntervalSeconds,
} from "./sse-keep-alive";
import type { ResolvedDebugConfig } from "@copilotkit/shared";
import { createLogger } from "../../../../v1-deprecated/lib/logger";
import type { CopilotRuntimeLogger } from "../../../../v1-deprecated/lib/logger";
import { telemetry as defaultTelemetry } from "../../telemetry";
import type { TelemetryCapture } from "../../telemetry/telemetry-client";
import type { AgentExecutionResponseInfo } from "../../telemetry/events";
import type { DebugEventBus } from "../../core/debug-event-bus";
import type {
  RuntimeErrorPhase,
  RuntimeErrorReporter,
} from "../../core/runtime-error-reporter";

interface CreateSseEventResponseParams {
  request: Request;
  observableFactory: () =>
    | Promise<Observable<BaseEvent>>
    | Observable<BaseEvent>;
  debugEventBus?: DebugEventBus;
  agentId?: string;
  debug?: ResolvedDebugConfig;
  /** Pre-created logger instance to avoid creating a new pino logger per request. */
  logger?: CopilotRuntimeLogger;
  /** Runtime-bound telemetry capture. Falls back for external direct callers. */
  telemetry?: TelemetryCapture;
  /**
   * Execution facts known before the stream opens, merged under anything the
   * upstream reports as it runs. Carries `llmHostClass`, which is knowable
   * from the agent's configuration and never appears on a streamed event.
   */
  executionSeed?: AgentExecutionResponseInfo;
  /**
   * Whether to emit `oss.runtime.agent_execution_stream_*` telemetry for this
   * stream. Defaults to `true`. The stateless `/suggest` path sets this to
   * `false`: a suggestion is a side-effect-free structured completion, not a
   * tracked run, and under `available: "always"` it fires often enough to flood
   * run telemetry.
   */
  captureTelemetry?: boolean;
  runtimeErrorReporter?: RuntimeErrorReporter;
  startTime?: number;
  /**
   * Seconds of silence before a `: keep-alive` SSE comment is written.
   * `0` disables the keep-alive. Resolved by
   * {@link resolveSseKeepAliveIntervalSeconds}, which supplies the default
   * and enforces the timer bound for every caller.
   */
  keepAliveIntervalSeconds?: number;
}

export function createSseEventResponse({
  request,
  observableFactory,
  debugEventBus,
  agentId,
  debug,
  logger,
  telemetry = defaultTelemetry,
  executionSeed,
  captureTelemetry = true,
  runtimeErrorReporter,
  startTime,
  keepAliveIntervalSeconds,
}: CreateSseEventResponseParams): Response {
  const keepAliveSeconds = resolveSseKeepAliveIntervalSeconds(
    keepAliveIntervalSeconds,
  );
  const stream = new TransformStream();
  const writer = stream.writable.getWriter();
  const encoder = new EventEncoder();
  let streamClosed = false;
  let debugThreadId = "";
  let debugRunId = "";

  const debugLogger = debug?.enabled
    ? (logger ??
      createLogger({ level: "debug", component: "copilotkit-debug" }))
    : undefined;

  const closeStream = async () => {
    if (!streamClosed) {
      try {
        await writer.close();
        streamClosed = true;
      } catch {
        // Stream already closed.
      }
    }
  };

  const logError = (error: unknown) => {
    console.error("Error running agent:", error);
    console.error(
      "Error stack:",
      error instanceof Error ? error.stack : "No stack trace",
    );
    console.error("Error details:", {
      name: error instanceof Error ? error.name : "Unknown",
      message: error instanceof Error ? error.message : String(error),
      cause: error instanceof Error ? error.cause : undefined,
    });
  };

  let subscription: Subscription | undefined;
  let agentErrorReported = false;

  const reportAgentError = (error: unknown, phase: RuntimeErrorPhase) => {
    if (agentErrorReported) return;
    agentErrorReported = true;
    runtimeErrorReporter?.report({
      request,
      error,
      operation: "agent.run",
      agentId,
      threadId: debugThreadId || undefined,
      runId: debugRunId || undefined,
      phase,
      startTime,
    });
  };

  (async () => {
    const observable = await observableFactory();

    if (captureTelemetry) {
      telemetry.capture("oss.runtime.agent_execution_stream_started", {});
    }

    if (debug?.lifecycle) {
      debugLogger!.debug("SSE stream opened");
    }

    let eventCount = 0;
    let loggedEventCount = 0;

    // Provider/model/LangGraph facts, scraped off raw upstream events as
    // they pass and reported once the stream finishes. This moved here from
    // the v1 TelemetryAgentRunner, which wrapped the runner purely to
    // collect it and emitted its own duplicate copy of every stream event
    // to carry it. v2 callers had no equivalent and reported `{}`.
    // Seeded rather than empty: `llmHostClass` comes from the agent's config,
    // not from the wire, so nothing streamed will ever fill it in. Scraped
    // fields still win, since `collectExecutionInfo` writes over this.
    const executionInfo: AgentExecutionResponseInfo = { ...executionSeed };

    subscription = observable.subscribe({
      next: async (event) => {
        collectExecutionInfo(event, executionInfo);

        // Extract threadId/runId from RUN_STARTED
        if (event.type === "RUN_STARTED") {
          const e = event as { threadId?: string; runId?: string };
          debugThreadId = e.threadId ?? "";
          debugRunId = e.runId ?? "";
        }

        if (event.type === "RUN_ERROR") {
          const e = event as {
            message?: unknown;
            threadId?: string;
            runId?: string;
          };
          debugThreadId = e.threadId ?? debugThreadId;
          debugRunId = e.runId ?? debugRunId;
          reportAgentError(
            new Error(
              typeof e.message === "string"
                ? e.message
                : "Runner reported a run error",
            ),
            "sse.subscription",
          );
        }

        // Broadcast to debug listeners BEFORE the stream-closed gate below.
        // Intentional: debug subscribers (e.g. the VS Code Inspector panel)
        // should still receive trailing events after the SSE client for
        // this request closed its connection — they're independent
        // consumers observing the underlying runtime, not the request's
        // response stream.
        //
        // Wrapped in try/catch so a buggy debug subscriber can't propagate
        // an exception into this observer — if the throw reached the
        // `next` callback it would get routed to `error` by RxJS, closing
        // the SSE stream for an unrelated reason. Log via `logError` and
        // move on.
        if (debugEventBus) {
          try {
            debugEventBus.broadcast(event, {
              agentId: agentId ?? "",
              threadId: debugThreadId,
              runId: debugRunId,
            });
          } catch (broadcastError) {
            logError(broadcastError);
          }
        }

        if (!request.signal.aborted && !streamClosed) {
          try {
            eventCount++;
            if (debug?.events) {
              loggedEventCount++;
              if (debug.verbose) {
                debugLogger!.debug({ event }, "Event emitted");
              } else {
                debugLogger!.debug(
                  { type: event.type, ...summarizeEvent(event) },
                  "Event emitted",
                );
              }
            }
            await writer.write(encoder.encodeBinary(event));
          } catch (error) {
            if (error instanceof Error && error.name === "AbortError") {
              streamClosed = true;
            } else {
              // Non-abort write failures (backpressure disconnects,
              // transform-stream exceptions, …) were previously swallowed
              // silently — `streamClosed` stayed `false` and the next
              // event re-attempted a broken writer. Log and mark the
              // stream closed so we stop trying.
              logError(error);
              streamClosed = true;
            }
          }
        }
      },
      error: async (error) => {
        reportAgentError(error, "sse.subscription");
        if (captureTelemetry) {
          telemetry.capture("oss.runtime.agent_execution_stream_errored", {
            ...executionInfo,
            error: error instanceof Error ? error.message : String(error),
          });
        }
        if (debug?.lifecycle) {
          debugLogger!.debug(
            { error: error instanceof Error ? error.message : String(error) },
            "SSE stream errored",
          );
        }
        logError(error);
        await closeStream();
      },
      complete: async () => {
        if (captureTelemetry) {
          telemetry.capture(
            "oss.runtime.agent_execution_stream_ended",
            executionInfo,
          );
        }
        if (debug?.lifecycle) {
          debugLogger!.debug(
            { eventCount, loggedEventCount },
            "SSE stream completed",
          );
        }
        await closeStream();
      },
    });

    // If the client disconnected before the subscription was created,
    // unsubscribe immediately to avoid leaking the observable.
    if (request.signal.aborted) {
      subscription.unsubscribe();
    }
  })().catch(async (error) => {
    reportAgentError(error, "sse.factory");
    logError(error);
    await closeStream();
  });

  request.signal.addEventListener("abort", () => {
    subscription?.unsubscribe();
    closeStream();
  });

  const body =
    keepAliveSeconds > 0
      ? keepAliveSse(stream.readable, keepAliveSeconds * 1_000)
      : stream.readable;

  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}

function summarizeEvent(event: BaseEvent): Record<string, unknown> {
  const e = event as any;
  const summary: Record<string, unknown> = {};

  if (e.messageId) summary.messageId = e.messageId;
  if (e.toolCallId) summary.toolCallId = e.toolCallId;
  if (e.toolCallName) summary.toolCallName = e.toolCallName;
  if (e.role) summary.role = e.role;
  if (e.delta != null && typeof e.delta === "string")
    summary.deltaLength = e.delta.length;
  if (e.snapshot && typeof e.snapshot === "object")
    summary.snapshotKeys = Object.keys(e.snapshot);
  if (e.delta && Array.isArray(e.delta))
    summary.operationCount = e.delta.length;
  if (e.threadId) summary.threadId = e.threadId;
  if (e.runId) summary.runId = e.runId;
  if (e.message) summary.message = e.message;
  if (e.code) summary.code = e.code;
  if (e.stepName) summary.stepName = e.stepName;

  return summary;
}

/**
 * Accumulate provider, model, and LangGraph facts from one upstream event.
 *
 * Mutates rather than returns so the caller keeps one record across the whole
 * stream: these arrive on different events and the last one wins. Only fields
 * the upstream actually sent are set, so an agent that reports none leaves the
 * record empty and the stream events carry `{}` as before.
 *
 * `rawEvent` is the untransformed upstream payload, present on AG-UI events
 * that wrap one. Its shape is the provider's, not ours, hence the narrowing.
 */
function collectExecutionInfo(
  event: BaseEvent,
  into: AgentExecutionResponseInfo,
): void {
  const rawEvent = (
    event as {
      rawEvent?: {
        metadata?: Record<string, unknown>;
        data?: Record<string, unknown>;
      };
    }
  ).rawEvent;
  if (!rawEvent) return;

  const model = (rawEvent.data as { output?: { model?: string } } | undefined)
    ?.output?.model;
  if (model) {
    into.model = model;
    // Carried forward from the v1 implementation, which set both from the
    // same field. The upstream sends no separate provider name.
    into.provider = model;
  }

  const metadata = rawEvent.metadata as
    | { langgraph_host?: string; langgraph_version?: string }
    | undefined;
  if (metadata?.langgraph_host) into.langGraphHost = metadata.langgraph_host;
  if (metadata?.langgraph_version) {
    into.langGraphVersion = metadata.langgraph_version;
  }
}
