import {
  CopilotRuntime,
  ExperimentalEmptyAdapter,
  copilotRuntimeNextJSAppRouterEndpoint,
} from "@copilotkit/runtime";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import crypto from "node:crypto";
// The demo-alias registry (`demoAgentNames`, `buildAgents`, `getAgents`) now
// lives in `@/agent-registry` so BOTH this in-process Next.js route AND the
// standalone AG-UI HTTP agent server (`src/agent_server.ts`) can build the
// exact same agent map from one source. Re-exported below for backwards
// compatibility — existing tests import these names from this module.
import { getAgents } from "@/agent-registry";
// `withForwardedHeaders` binds inbound x-* headers (e.g. x-aimock-context)
// into an AsyncLocalStorage scope so the wrapped @ai-sdk/openai provider's
// fetch can re-attach them on outbound LLM calls. Required because the
// @ag-ui/mastra adapter does not forward inbound headers to Vercel AI SDK.
import { withForwardedHeaders } from "@/mastra/_header_forwarding";
// CVDIAG backend instrumentation (L1-E). No-op pass-through unless
// CVDIAG_BACKEND_EMITTER is set truthy (default OFF).
import { withCvdiagBackend } from "@/cvdiag-backend";

// We use ExperimentalEmptyAdapter because Mastra agents drive the LLM
// themselves — the CopilotKit runtime only brokers AG-UI events between
// the frontend and the agent. A real adapter (OpenAI/Anthropic/etc.) would
// try to issue its own LLM calls and conflict with the agent's own loop.
const serviceAdapter = new ExperimentalEmptyAdapter();

// Startup log: make the adapter choice visible in boot logs so operators
// debugging "why is the runtime not calling the LLM?" can find the answer
// without reading source.
console.log(
  "[copilotkit route] init: serviceAdapter=ExperimentalEmptyAdapter (Mastra agents drive the LLM)",
);

// Backwards-compatible re-exports. These symbols moved to `@/agent-registry`
// (see the import comment above); tests and other modules still import them
// from this route module, and the demo pages' agent names are unchanged.
export {
  buildAgents,
  demoAgentNames,
  getAgents,
  __resetAgentsCacheForTests,
} from "@/agent-registry";
export type {
  BuiltAgents,
  DemoAgentName,
  LocalMastraAgentName,
} from "@/agent-registry";

// Emit a structured error log with a correlation id. Extracted so every
// failure path uses an identical shape — operators grep for `errorId`
// regardless of where the failure occurred. Phases:
//   - "setup": everything that happens BEFORE headers flush. Covers agent
//     cache construction, runtime instantiation, and synchronous failures
//     inside `wrapStreamingResponse` (malformed Response from handleRequest,
//     etc.) — all of which still allow us to return a 500 JSON envelope.
//   - "stream": mid-stream failures observed by the body wrapper AFTER
//     headers have been committed — we can no longer change the status, only
//     log.
// Returns the generated errorId so callers can include it in client-facing
// responses when appropriate.
function logRouteError(err: unknown, phase: "setup" | "stream"): string {
  const error = err instanceof Error ? err : new Error(String(err));
  const errorId = crypto.randomUUID();
  console.error(
    JSON.stringify({
      at: new Date().toISOString(),
      level: "error",
      phase,
      errorId,
      message: error.message,
      stack: error.stack,
    }),
  );
  return errorId;
}

// Wrap a streaming Response body with a TransformStream that forwards chunks
// verbatim but catches any error thrown by the upstream source AFTER headers
// have been flushed. Without this, a rejection inside handleRequest's SSE
// loop escapes every try/catch and leaves the frontend with a mute aborted
// stream — no log, no errorId, no way to correlate.
//
// We cannot turn a half-flushed 200 into a 500 (headers are already out) but
// we CAN guarantee the failure is logged server-side with the same errorId
// shape as the pre-stream path. Operators grepping logs for the errorId
// pattern will find both classes of failure.
function wrapStreamingResponse(response: Response): Response {
  // Non-streaming (or empty) responses pass through untouched.
  if (!response.body) {
    return response;
  }

  const source = response.body;
  const monitored = new ReadableStream<Uint8Array>({
    async start(controller) {
      const reader = source.getReader();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          controller.enqueue(value);
        }
        controller.close();
      } catch (err) {
        // The frontend will see an aborted stream regardless; our job is to
        // leave a server-side breadcrumb with a correlation id.
        logRouteError(err, "stream");
        try {
          controller.error(err);
        } catch {
          // controller already errored/closed — nothing more to do.
        }
      } finally {
        try {
          reader.releaseLock();
        } catch {
          // lock already released
        }
      }
    },
    cancel(reason) {
      return source.cancel(reason);
    },
  });

  return new Response(monitored, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}

// Next.js App Router POST handler for CopilotKit runtime requests. Wraps the
// runtime's handler so three classes of failure are logged with a
// correlation id:
//   1. Synchronous construction errors (bad mastra config, missing
//      weatherAgent, etc.) — caught by the outer try/catch, 500 returned.
//   2. Synchronous wrap-time errors (e.g. malformed Response from
//      handleRequest that makes `wrapStreamingResponse` itself throw) —
//      caught separately so we can cancel the upstream body before the 500
//      goes out. Without this cancel, the ReadableStream returned by
//      handleRequest leaks (no consumer ever reads it).
//   3. Mid-stream errors (thrown after response headers have been flushed)
//      — caught inside the TransformStream in `wrapStreamingResponse`.
const copilotkitPost = async (req: NextRequest): Promise<Response> =>
  // Bind inbound x-* headers into ALS for the duration of this request so
  // the wrapped @ai-sdk/openai provider's fetch can attach them on every
  // outbound LLM call (e.g. x-aimock-context for aimock fixture matching).
  withForwardedHeaders(req, async () => {
    let response: Response | undefined;
    try {
      const runtime = new CopilotRuntime({
        agents: getAgents(),
      });

      const { handleRequest } = copilotRuntimeNextJSAppRouterEndpoint({
        runtime,
        serviceAdapter,
        endpoint: "/api/copilotkit",
      });

      response = await handleRequest(req);
    } catch (err) {
      const errorId = logRouteError(err, "setup");
      return NextResponse.json(
        { error: "internal runtime error", errorId },
        { status: 500 },
      );
    }

    try {
      return wrapStreamingResponse(response);
    } catch (err) {
      // `wrapStreamingResponse` threw synchronously (e.g. malformed
      // `response.headers`). The upstream ReadableStream has been produced
      // but nobody is going to consume it — cancel it explicitly to release
      // whatever resources the runtime holds open behind the body. Swallow
      // errors from cancel itself; we're already on the 500 path.
      try {
        await response.body?.cancel();
      } catch {
        // best-effort cleanup; the primary error is already being logged below
      }
      const errorId = logRouteError(err, "setup");
      return NextResponse.json(
        { error: "internal runtime error", errorId },
        { status: 500 },
      );
    }
  });

// Wrap with CVDIAG backend instrumentation (L1-E). No-op pass-through unless
// CVDIAG_BACKEND_EMITTER is set truthy (default OFF).
export const POST = withCvdiagBackend(copilotkitPost, {
  slug: "mastra",
  agentName: "weatherAgent",
  provider: "openai",
});
