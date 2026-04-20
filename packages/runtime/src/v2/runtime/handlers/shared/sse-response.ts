import { BaseEvent } from "@ag-ui/client";
import { EventEncoder } from "@ag-ui/encoder";
import { Observable, Subscription } from "rxjs";
import { ResolvedDebugConfig } from "@copilotkit/shared";
import {
  createLogger,
  type CopilotRuntimeLogger,
} from "../../../../lib/logger";
import { telemetry } from "../../telemetry";

interface CreateSseEventResponseParams {
  request: Request;
  observableFactory: () =>
    | Promise<Observable<BaseEvent>>
    | Observable<BaseEvent>;
  debug?: ResolvedDebugConfig;
  /** Pre-created logger instance to avoid creating a new pino logger per request. */
  logger?: CopilotRuntimeLogger;
}

export function createSseEventResponse({
  request,
  observableFactory,
  debug,
  logger,
}: CreateSseEventResponseParams): Response {
  const stream = new TransformStream();
  const writer = stream.writable.getWriter();
  const encoder = new EventEncoder();
  let streamClosed = false;

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

  (async () => {
    const observable = await observableFactory();

    telemetry.capture("oss.runtime.agent_execution_stream_started", {});

    if (debug?.lifecycle) {
      debugLogger!.debug("SSE stream opened");
    }

    let eventCount = 0;
    let loggedEventCount = 0;

    subscription = observable.subscribe({
      next: async (event) => {
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
            await writer.write(encoder.encode(event));
          } catch (error) {
            if (error instanceof Error && error.name === "AbortError") {
              streamClosed = true;
            }
          }
        }
      },
      error: async (error) => {
        telemetry.capture("oss.runtime.agent_execution_stream_errored", {
          error: error instanceof Error ? error.message : String(error),
        });
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
        telemetry.capture("oss.runtime.agent_execution_stream_ended", {});
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
    logError(error);
    await closeStream();
  });

  request.signal.addEventListener("abort", () => {
    subscription?.unsubscribe();
  });

  return new Response(stream.readable, {
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
