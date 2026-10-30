// Dedicated runtime for the /demos/voice cell (MS Agent Python).
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
// Wires the V2 `CopilotRuntime` directly because the V1 wrapper drops the
// `transcriptionService` option. V2 URL-routes on `/info`, `/agent/:id/run`,
// `/transcribe`, etc., so the route lives at `[[...slug]]/route.ts`.

// @region[voice-runtime]
import type { NextRequest } from "next/server";
import {
  CopilotRuntime,
  createCopilotRuntimeHandler,
} from "@copilotkit/runtime/v2";
import { HttpAgent } from "@ag-ui/client";
import { createTranscriptionService } from "@/lib/transcription-service";

const AGENT_URL = process.env.AGENT_URL || "http://localhost:8000";

// Point at the tool-free /voice endpoint so aimock returns a direct text
// response instead of a tool call that the agent can't summarize.
const voiceDemoAgent = new HttpAgent({ url: `${AGENT_URL}/voice/` });

let cachedHandler: ((req: Request) => Promise<Response>) | null = null;
function getHandler(): (req: Request) => Promise<Response> {
  if (cachedHandler) return cachedHandler;

  const runtime = new CopilotRuntime({
    // @ts-ignore -- Published CopilotRuntime agents type wraps Record in
    // MaybePromise<NonEmptyRecord<...>> which rejects plain Records; fixed in
    // source, pending release.
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

export const POST = (req: NextRequest) => getHandler()(req);
export const GET = (req: NextRequest) => getHandler()(req);
export const PUT = (req: NextRequest) => getHandler()(req);
export const DELETE = (req: NextRequest) => getHandler()(req);
// @endregion[voice-runtime]
