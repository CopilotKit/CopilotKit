// Dedicated runtime for the /demos/voice cell (Langroid).
//
// Goals
// -----
// 1. Advertise `audioFileTranscriptionEnabled: true` on `/info` so the chat
//    composer renders the mic button.
// 2. Handle `POST /transcribe` by invoking an OpenAI-backed
//    `TranscriptionServiceOpenAI` (from `@copilotkit/voice`), so recorded
//    audio is transcribed and the transcript auto-sends.
// 3. Return a deterministic 4xx when `OPENAI_API_KEY` is not configured.
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
// @region[transcription-service-guard]
import type { NextRequest } from "next/server";
import {
  CopilotRuntime,
  TranscriptionService,
  createCopilotRuntimeHandler,
} from "@copilotkit/runtime/v2";
import type { TranscribeFileOptions } from "@copilotkit/runtime/v2";
import { HttpAgent } from "@ag-ui/client";
import { TranscriptionServiceOpenAI } from "@copilotkit/voice";
import OpenAI from "openai";

const AGENT_URL = process.env.AGENT_URL || "http://localhost:8000";

const voiceDemoAgent = new HttpAgent({ url: `${AGENT_URL}/` });

/**
 * Transcription service wrapper that reports a clean, typed auth error when
 * OPENAI_API_KEY is not configured. When the key is present we delegate to
 * the real OpenAI-backed service.
 *
 * "api key" substring in the thrown error is matched by the V2 runtime's
 * `handleTranscribe` and mapped to `AUTH_FAILED → HTTP 401`.
 */
class GuardedOpenAITranscriptionService extends TranscriptionService {
  private delegate: TranscriptionServiceOpenAI | null;

  constructor() {
    super();
    const apiKey = process.env.OPENAI_API_KEY;
    this.delegate = apiKey
      ? new TranscriptionServiceOpenAI({ openai: new OpenAI({ apiKey }) })
      : null;
  }

  async transcribeFile(options: TranscribeFileOptions): Promise<string> {
    if (!this.delegate) {
      throw new Error(
        "OPENAI_API_KEY not configured for this deployment (api key missing). " +
          "Set OPENAI_API_KEY to enable voice transcription.",
      );
    }
    return this.delegate.transcribeFile(options);
  }
}
// @endregion[transcription-service-guard]

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
    transcriptionService: new GuardedOpenAITranscriptionService(),
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
