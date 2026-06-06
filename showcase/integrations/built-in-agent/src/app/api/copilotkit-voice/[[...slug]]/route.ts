// Dedicated runtime for the voice demo.
//
// 1. Advertises `audioFileTranscriptionEnabled: true` on `/info` so the chat
//    composer renders the mic button.
// 2. Handles `POST /transcribe` by invoking an OpenAI-backed
//    `TranscriptionServiceOpenAI` (from `@copilotkit/voice`).
// 3. Returns a deterministic 401 when `OPENAI_API_KEY` is not configured —
//    `handleTranscribe` maps "api key" / "unauthorized" messages to
//    AUTH_FAILED → HTTP 401.
//
// Lives at `[[...slug]]/route.ts` because the V2 router URL-routes on
// `/info`, `/transcribe`, etc., under the same base path.

// @region[voice-runtime]
// @region[transcription-service-guard]
import type { NextRequest } from "next/server";
import {
  CopilotRuntime,
  TranscriptionService,
  createCopilotRuntimeHandler,
  InMemoryAgentRunner,
} from "@copilotkit/runtime/v2";
import type { TranscribeFileOptions } from "@copilotkit/runtime/v2";
import { TranscriptionServiceOpenAI } from "@copilotkit/voice";
import OpenAI from "openai";
import { createBuiltInAgent } from "@/lib/factory/tanstack-factory";
// Wrap handlers so inbound x-* headers (e.g. x-aimock-context) are bound
// into ALS for the factory's `forwardingFetch` to re-attach on outbound
// LLM calls. See @/lib/header-forwarding for the full rationale.
import { withForwardedHeaders } from "@/lib/header-forwarding";

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
// @endregion[transcription-service-guard]

let cachedHandler: ((req: Request) => Promise<Response>) | null = null;
function getHandler(): (req: Request) => Promise<Response> {
  if (cachedHandler) return cachedHandler;

  const runtime = new CopilotRuntime({
    agents: { default: createBuiltInAgent() },
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
