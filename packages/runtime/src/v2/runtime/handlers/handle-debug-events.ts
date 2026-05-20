import { CopilotRuntimeLike } from "../core/runtime";
import { DebugEventEnvelope } from "@copilotkit/shared";

interface HandleDebugEventsParams {
  runtime: CopilotRuntimeLike;
  request: Request;
}

export function handleDebugEvents({
  runtime,
  request,
}: HandleDebugEventsParams): Response {
  if (process.env.NODE_ENV === "production") {
    return new Response("Not Found", { status: 404 });
  }

  if (!runtime.debugEventBus) {
    return new Response("Debug event bus not available", { status: 503 });
  }

  const bus = runtime.debugEventBus;
  const encoder = new TextEncoder();
  const stream = new TransformStream();
  const writer = stream.writable.getWriter();

  // Send an SSE comment immediately to flush response headers to the client.
  // Without this, some frameworks buffer the response until actual data is written,
  // leaving the client stuck in "connecting" state.
  writer.write(encoder.encode(": connected\n\n")).catch(() => {});

  const unsubscribe = bus.subscribe((envelope: DebugEventEnvelope) => {
    if (request.signal.aborted) return;
    const line = `data: ${JSON.stringify(envelope)}\n\n`;
    writer.write(encoder.encode(line)).catch(() => {
      // Client disconnected, will be cleaned up by abort handler.
    });
  });

  request.signal.addEventListener("abort", () => {
    unsubscribe();
    writer.close().catch(() => {});
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
