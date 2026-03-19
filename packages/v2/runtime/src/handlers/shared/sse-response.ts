import { BaseEvent } from "@ag-ui/client";
import { EventEncoder } from "@ag-ui/encoder";
import { Observable, Subscription } from "rxjs";
import { telemetry } from "../../telemetry";

interface CreateSseEventResponseParams {
  request: Request;
  observableFactory: () =>
    | Promise<Observable<BaseEvent>>
    | Observable<BaseEvent>;
}

export function createSseEventResponse({
  request,
  observableFactory,
}: CreateSseEventResponseParams): Response {
  const stream = new TransformStream();
  const writer = stream.writable.getWriter();
  const encoder = new EventEncoder();
  let streamClosed = false;

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

    subscription = observable.subscribe({
      next: async (event) => {
        if (!request.signal.aborted && !streamClosed) {
          try {
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
        logError(error);
        await closeStream();
      },
      complete: async () => {
        telemetry.capture("oss.runtime.agent_execution_stream_ended", {});
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
