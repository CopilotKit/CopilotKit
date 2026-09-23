// Dedicated runtime for the /demos/voice cell (Strands).
//
// Goals
// -----
// 1. Advertise `audioFileTranscriptionEnabled: true` on `/info` so the chat
//    composer renders the mic button.
// 2. Handle `POST /transcribe` with the shared voice transcription service
//    (`src/app/demos/voice/transcription-service.ts`), which owns the
//    endpoint and credential policy for every integration.
// 3. Return a deterministic 401 when `OPENAI_API_KEY` is not configured.
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
import { GuardedOpenAITranscriptionService } from "@/app/demos/voice/transcription-service";

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
    transcriptionService: new GuardedOpenAITranscriptionService(),
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
