import type { CopilotRuntimeLike } from "../core/runtime";
import type { DebugEventEnvelope } from "@copilotkit/shared";

interface HandleDebugEventsParams {
  runtime: CopilotRuntimeLike;
  request: Request;
}

/**
 * Dev-only CORS headers for `/cpk-debug-events`.
 *
 * The CopilotKit Studio SPA (`apps/studio`) hits this endpoint from a
 * different origin (the launcher serves the SPA on `localhost:4123` while the
 * user's runtime typically lives on `localhost:3000`). Without these headers
 * `EventSource` rejects the stream and the studio's timeline drawer stays
 * empty.
 *
 * Production is locked down by the existing 404 above — these headers only
 * exist when `NODE_ENV !== 'production'`. Mirrors the broader CORS posture in
 * `fetch-cors.ts` but is scoped to this handler so users who haven't opted
 * into the framework-level `cors: true` config still get a working studio.
 */
function buildDebugCorsHeaders(): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "*",
    Vary: "Origin",
  };
}

export function handleDebugEvents({
  runtime,
  request,
}: HandleDebugEventsParams): Response {
  if (process.env.NODE_ENV === "production") {
    return new Response("Not Found", { status: 404 });
  }

  // Browsers preflight cross-origin SSE attempts with custom headers via
  // OPTIONS. Reply 204 with the same CORS surface so the subsequent GET
  // succeeds without going through the framework-level CORS pipeline.
  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: buildDebugCorsHeaders(),
    });
  }

  if (!runtime.debugEventBus) {
    return new Response("Debug event bus not available", {
      status: 503,
      headers: buildDebugCorsHeaders(),
    });
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
      ...buildDebugCorsHeaders(),
    },
  });
}
