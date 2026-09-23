// Dedicated runtime for the voice demo.
//
// 1. Advertises `audioFileTranscriptionEnabled: true` on `/info` so the chat
//    composer renders the mic button.
// 2. Handles `POST /transcribe` with the shared voice transcription service
//    (`src/app/demos/voice/transcription-service.ts`), which owns the
//    endpoint and credential policy for every integration.
// 3. Returns a deterministic 401 when `OPENAI_API_KEY` is not configured.
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
// Wrap handlers so inbound x-* headers (e.g. x-aimock-context) are bound
// into ALS for the factory's `forwardingFetch` to re-attach on outbound
// LLM calls. See @/lib/header-forwarding for the full rationale.
import { withForwardedHeaders } from "@/lib/header-forwarding";
import { GuardedOpenAITranscriptionService } from "@/app/demos/voice/transcription-service";

let cachedHandler: ((req: Request) => Promise<Response>) | null = null;
function getHandler(): (req: Request) => Promise<Response> {
  if (cachedHandler) return cachedHandler;

  const runtime = new CopilotRuntime({
    agents: { "voice-demo": createBuiltInAgent() },
    runner: new InMemoryAgentRunner(),
    transcriptionService: new GuardedOpenAITranscriptionService(),
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
