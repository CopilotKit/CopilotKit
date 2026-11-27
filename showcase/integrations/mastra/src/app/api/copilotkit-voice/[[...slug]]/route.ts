// Dedicated runtime for the /demos/voice cell (Mastra).
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
// because the V1 wrapper drops `transcriptionService` on the floor. V2
// URL-routes on `/info`, `/agent/:id/run`, `/transcribe`, etc., so this
// route lives at `[[...slug]]/route.ts` to catch all sub-paths under
// `/api/copilotkit-voice`.

// @region[voice-runtime]
import type { NextRequest } from "next/server";
import {
  CopilotRuntime,
  createCopilotRuntimeHandler,
} from "@copilotkit/runtime/v2";
import { getLocalAgent } from "@ag-ui/mastra";
import { createTranscriptionService } from "@/lib/transcription-service";
import { mastra } from "@/mastra";
import { withForwardedHeaders } from "@/mastra/_header_forwarding";

const voiceDemoAgent = getLocalAgent({
  mastra,
  agentId: "weatherAgent",
  resourceId: "mastra-voice-demo",
});

if (!voiceDemoAgent) {
  throw new Error(
    "getLocalAgent returned null for weatherAgent — required for /demos/voice",
  );
}

let cachedHandler: ((req: Request) => Promise<Response>) | null = null;
function getHandler(): (req: Request) => Promise<Response> {
  if (cachedHandler) return cachedHandler;

  const runtime = new CopilotRuntime({
    // @ts-ignore -- see main route.ts
    agents: {
      "voice-demo": voiceDemoAgent,
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

export const POST = (req: NextRequest) =>
  withForwardedHeaders(req, () => getHandler()(req));
export const GET = (req: NextRequest) =>
  withForwardedHeaders(req, () => getHandler()(req));
export const PUT = (req: NextRequest) =>
  withForwardedHeaders(req, () => getHandler()(req));
export const DELETE = (req: NextRequest) =>
  withForwardedHeaders(req, () => getHandler()(req));
// @endregion[voice-runtime]
