// Dedicated runtime for the /demos/voice cell (Langroid).
//
// Goals
// -----
// 1. Advertise audio transcription on `/info` only when a dedicated
//    transcription credential (`OPENAI_TRANSCRIPTION_API_KEY`) is
//    configured, so the mic is never backed by the deployment's
//    `OPENAI_API_KEY`, which is the aimock client credential here.
// 2. Handle `POST /transcribe` through that service. Without the dedicated
//    credential the runtime reports transcription as disabled and answers
//    `/transcribe` with its documented 503 (service not configured); no
//    other key is ever sent.
//
// Implementation
// --------------
// Wires the **V2** `CopilotRuntime` directly (from `@copilotkit/runtime/v2`)
// because the V1 wrapper drops the `transcriptionService` option on the floor.
// V2 URL-routes on `/info`, `/agent/:id/run`, `/transcribe`, etc., so the
// route file lives at `[[...slug]]/route.ts` to catch every sub-path under
// `/api/copilotkit-voice`.
//
// The actual chat agent is the unified Langroid AG-UI backend that runs at
// `${AGENT_URL}/` (port 8000 by default). We register an `HttpAgent` against
// it under the "voice-demo" slug used by the page.

// @region[voice-runtime]
import type { NextRequest } from "next/server";
import {
  CopilotRuntime,
  createCopilotRuntimeHandler,
} from "@copilotkit/runtime/v2";
import { HttpAgent } from "@ag-ui/client";
import { createTranscriptionService } from "@/lib/transcription-service";

const AGENT_URL = process.env.AGENT_URL || "http://localhost:8000";

const voiceDemoAgent = new HttpAgent({ url: `${AGENT_URL}/` });

// Cache the runtime + handler across invocations so the transcription service
// is constructed once per Node process instead of per request.
let cachedHandler: ((req: Request) => Promise<Response>) | null = null;
function getHandler(): (req: Request) => Promise<Response> {
  if (cachedHandler) return cachedHandler;

  const runtime = new CopilotRuntime({
    // @ts-ignore -- Published CopilotRuntime agents type wraps Record in
    // MaybePromise<NonEmptyRecord<...>> which rejects plain Records; fixed in
    // source, pending release.
    agents: {
      // The page mounts <CopilotKit agent="voice-demo">; resolve that to the
      // unified Langroid AG-UI endpoint.
      "voice-demo": voiceDemoAgent,
      // useAgent() with no args defaults to "default"; alias so any internal
      // default-agent lookups resolve against the same agent.
      default: voiceDemoAgent,
    },
    transcriptionService: createTranscriptionService(),
  });

  cachedHandler = createCopilotRuntimeHandler({
    runtime,
    basePath: "/api/copilotkit-voice",
  });
  return cachedHandler;
}

// Next.js App Router bindings. Catchall slug forwards every sub-path
// (`/info`, `/agent/:id/run`, `/transcribe`, ...) to the V2 handler.
export const POST = (req: NextRequest) => getHandler()(req);
export const GET = (req: NextRequest) => getHandler()(req);
export const PUT = (req: NextRequest) => getHandler()(req);
export const DELETE = (req: NextRequest) => getHandler()(req);
// @endregion[voice-runtime]
