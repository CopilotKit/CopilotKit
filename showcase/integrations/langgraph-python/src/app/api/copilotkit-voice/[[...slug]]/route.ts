// Dedicated runtime for the /demos/voice cell.
//
// Goals
// -----
// 1. Advertise audio transcription on `/info` only when the dedicated
//    `OPENAI_TRANSCRIPTION_API_KEY` is configured, so the chat composer shows
//    the mic only when it can work. Unconfigured, `/transcribe` answers 503.
// 2. Handle `POST /transcribe` with the shared voice transcription service
//    (`src/app/demos/voice/transcription-service.ts`), which owns the
//    endpoint and credential policy for every integration.
//
// Implementation
// --------------
// Wires the **V2** `CopilotRuntime` directly (from `@copilotkit/runtime/v2`)
// because the V1 wrapper in `@copilotkit/runtime` drops the
// `transcriptionService` option on the floor (see the TODO on the V1
// constructor). V2 URL-routes on `/info`, `/agent/:id/run`, `/transcribe`,
// etc., so the route file lives at `[[...slug]]/route.ts` to catch all
// sub-paths under `/api/copilotkit-voice`.

// @region[voice-runtime]
import type { NextRequest } from "next/server";
import {
  CopilotRuntime,
  createCopilotRuntimeHandler,
} from "@copilotkit/runtime/v2";
import { LangGraphAgent } from "@copilotkit/runtime/langgraph";
import { createTranscriptionService } from "@/app/demos/voice/transcription-service";

const LANGGRAPH_URL =
  process.env.LANGGRAPH_DEPLOYMENT_URL || "http://localhost:8123";

const voiceDemoAgent = new LangGraphAgent({
  deploymentUrl: LANGGRAPH_URL,
  graphId: "sample_agent",
});

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
      // The page mounts <CopilotKit agent="voice-demo">; resolve that to
      // the neutral sample_agent graph.
      "voice-demo": voiceDemoAgent,
      // useAgent() with no args defaults to "default"; alias so any internal
      // default-agent lookups resolve against the same graph.
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

// Next.js App Router bindings. This file lives at
// `src/app/api/copilotkit-voice/[[...slug]]/route.ts` — the catchall slug
// pattern forwards every sub-path (`/info`, `/agent/:id/run`,
// `/transcribe`, ...) to the V2 handler so its URL router can dispatch.
export const POST = (req: NextRequest) => getHandler()(req);
export const GET = (req: NextRequest) => getHandler()(req);
export const PUT = (req: NextRequest) => getHandler()(req);
export const DELETE = (req: NextRequest) => getHandler()(req);
// @endregion[voice-runtime]
