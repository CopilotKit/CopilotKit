// Dedicated runtime for the /demos/voice cell (Agno).
//
// Goals:
// 1. Advertise audio transcription on `/info` only when a dedicated
//    transcription credential (`OPENAI_TRANSCRIPTION_API_KEY`) is
//    configured, so the mic is never backed by the deployment's
//    `OPENAI_API_KEY`, which is the aimock client credential here.
// 2. Handle `POST /transcribe` through that service. Without the dedicated
//    credential the runtime reports transcription as disabled and answers
//    `/transcribe` with its documented 503 (service not configured); no
//    other key is ever sent.
//
// Implementation: wires the V2 `CopilotRuntime` directly (the V1 wrapper
// drops the `transcriptionService` option on the floor). V2 URL-routes on
// `/info`, `/agent/:id/run`, `/transcribe`, etc., so the route lives at
// `[[...slug]]/route.ts` to catch every sub-path.

// @region[voice-runtime]
import type { NextRequest } from "next/server";
import {
  CopilotRuntime,
  createCopilotRuntimeHandler,
} from "@copilotkit/runtime/v2";
import { createTranscriptionService } from "@/lib/transcription-service";
import { HttpAgent } from "@ag-ui/client";

const AGENT_URL = process.env.AGENT_URL || "http://localhost:8000";

const voiceDemoAgent = new HttpAgent({ url: `${AGENT_URL}/agui` });

let cachedHandler: ((req: Request) => Promise<Response>) | null = null;
function getHandler(): (req: Request) => Promise<Response> {
  if (cachedHandler) return cachedHandler;

  const runtime = new CopilotRuntime({
    agents: {
      // @ts-expect-error -- see main route.ts
      "voice-demo": voiceDemoAgent,
      // @ts-expect-error -- see main route.ts
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

export const POST = (req: NextRequest) => getHandler()(req);
export const GET = (req: NextRequest) => getHandler()(req);
export const PUT = (req: NextRequest) => getHandler()(req);
export const DELETE = (req: NextRequest) => getHandler()(req);
// @endregion[voice-runtime]
