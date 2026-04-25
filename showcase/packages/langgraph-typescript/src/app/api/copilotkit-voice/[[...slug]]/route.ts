// Dedicated runtime for the /demos/voice cell.
//
// Goals
// -----
// 1. Advertise `audioFileTranscriptionEnabled: true` on `/info` so the chat
//    composer renders the mic button.
// 2. Handle `POST /transcribe` by invoking an OpenAI-backed
//    `TranscriptionServiceOpenAI` (from `@copilotkit/voice`), so recorded
//    audio is transcribed and the transcript auto-sends.
// 3. Return a deterministic 4xx when `OPENAI_API_KEY` is not configured,
//    instead of an opaque 5xx. The V2 runtime's `handleTranscribe` maps
//    error messages containing "api key" or "unauthorized" to
//    `AUTH_FAILED → HTTP 401`, so throwing with that message funnels the
//    missing-key case into the intended 4xx path.
//
// Implementation
// --------------
// Wires the **V2** `CopilotRuntime` directly (from `@copilotkit/runtime/v2`)
// because the V1 wrapper in `@copilotkit/runtime` drops the
// `transcriptionService` option on the floor (see the TODO on the V1
// constructor). V2 URL-routes on `/info`, `/agent/:id/run`, `/transcribe`,
// etc., so the route file lives at `[[...slug]]/route.ts` to catch all
// sub-paths under `/api/copilotkit-voice`.

import type { NextRequest } from "next/server";
import {
  CopilotRuntime,
  TranscriptionService,
  createCopilotRuntimeHandler,
} from "@copilotkit/runtime/v2";
import type { TranscribeFileOptions } from "@copilotkit/runtime/v2";
import { LangGraphAgent } from "@copilotkit/runtime/langgraph";
import { TranscriptionServiceOpenAI } from "@copilotkit/voice";
import OpenAI from "openai";

const LANGGRAPH_URL =
  process.env.AGENT_URL ||
  process.env.LANGGRAPH_DEPLOYMENT_URL ||
  "http://localhost:8123";

const voiceDemoAgent = new LangGraphAgent({
  deploymentUrl: `${LANGGRAPH_URL}/`,
  graphId: "sample_agent",
});

/**
 * Transcription service wrapper that reports a clean, typed auth error when
 * OPENAI_API_KEY is not configured. When the key is present we delegate to
 * the real OpenAI-backed service; any upstream Whisper error keeps its
 * natural categorization.
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
      // "api key" substring → handleTranscribe maps to AUTH_FAILED → 401.
      throw new Error(
        "OPENAI_API_KEY not configured for this deployment (api key missing). " +
          "Set OPENAI_API_KEY to enable voice transcription.",
      );
    }
    return this.delegate.transcribeFile(options);
  }
}

// Cache the runtime + handler across invocations so the transcription service
// is constructed once per Node process instead of per request. The guarded
// service reads OPENAI_API_KEY lazily in its transcribeFile call path, so
// deferring construction past module load is not required for cold-start
// safety under missing-key conditions.
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
    transcriptionService: new GuardedOpenAITranscriptionService(),
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
