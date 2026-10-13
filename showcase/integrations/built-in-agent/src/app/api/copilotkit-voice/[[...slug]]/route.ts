// Dedicated runtime for the voice demo.
//
// 1. Advertises audio transcription on `/info` only when a dedicated
//    transcription credential is configured, so the mic is never backed by
//    the deployment's text-only AIMock service.
// 2. Handles `POST /transcribe` through the configured transcription service.
//
// Lives at `[[...slug]]/route.ts` because the V2 router URL-routes on
// `/info`, `/transcribe`, etc., under the same base path.

// @region[voice-runtime]
import type { NextRequest } from "next/server";
import {
  CopilotRuntime,
  createCopilotRuntimeHandler,
  InMemoryAgentRunner,
} from "@copilotkit/runtime/v2";
import { createBuiltInAgent } from "@/lib/factory/tanstack-factory";
import { createTranscriptionService } from "@/lib/transcription-service";
// Wrap handlers so inbound x-* headers (e.g. x-aimock-context) are bound
// into ALS for the factory's `forwardingFetch` to re-attach on outbound
// LLM calls. See @/lib/header-forwarding for the full rationale.
import { withForwardedHeaders } from "@/lib/header-forwarding";

let cachedHandler: ((req: Request) => Promise<Response>) | null = null;
function getHandler(): (req: Request) => Promise<Response> {
  if (cachedHandler) return cachedHandler;

  const runtime = new CopilotRuntime({
    agents: { "voice-demo": createBuiltInAgent() },
    runner: new InMemoryAgentRunner(),
    transcriptionService: createTranscriptionService(),
  });

  cachedHandler = createCopilotRuntimeHandler({
    runtime,
    basePath: "/api/copilotkit-voice",
  });
  return cachedHandler;
}

export const POST = (req: NextRequest) =>
  withForwardedHeaders(req, () => getHandler()(req));
export const GET = (req: NextRequest) =>
  withForwardedHeaders(req, () => getHandler()(req));
export const PUT = (req: NextRequest) =>
  withForwardedHeaders(req, () => getHandler()(req));
export const DELETE = (req: NextRequest) =>
  withForwardedHeaders(req, () => getHandler()(req));
// @endregion[voice-runtime]
