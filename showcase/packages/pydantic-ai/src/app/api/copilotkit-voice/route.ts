// Dedicated runtime for the Voice demo.
//
// Mirrors showcase/packages/langgraph-python/src/app/api/copilotkit-voice/route.ts.
// The underlying backing agent is the main sales agent at the root
// PydanticAI mount — voice is an input-modality concern, not an
// agent-behaviour concern, so we do NOT spin up a dedicated PydanticAI
// agent for it.
//
// Two non-obvious things this file does:
//
// 1. It bypasses the V1 `CopilotRuntime` wrapper's silent drop of
//    `transcriptionService` by writing the service onto the V2 runtime
//    instance directly. See packages/runtime/src/lib/runtime/copilot-runtime.ts
//    — `transcriptionService` is Omit'ed from the V1 constructor type and
//    the constructor explicitly does not forward it to the V2 runtime
//    (see the "TODO: add support for transcriptionService" comment
//    there). Until that is unblocked upstream, per-demo routes that
//    need transcription must reach through `.instance`.
//
// 2. It always mounts a transcription service (so `/info` advertises the
//    mic-capable state and the composer renders the mic button) but
//    makes the service return a deterministic, human-readable error
//    when OPENAI_API_KEY is not set on the deployment. That keeps the
//    frontend affordance visible while failing loudly with a 4xx instead
//    of a silent 503 when the deployment is misconfigured.

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import {
  CopilotRuntime,
  ExperimentalEmptyAdapter,
  copilotRuntimeNextJSAppRouterEndpoint,
} from "@copilotkit/runtime";
import { TranscriptionService } from "@copilotkit/runtime/v2";
import type { TranscribeFileOptions } from "@copilotkit/runtime/v2";
import { TranscriptionServiceOpenAI } from "@copilotkit/voice";
import { AbstractAgent, HttpAgent } from "@ag-ui/client";
import OpenAI from "openai";

const AGENT_URL = process.env.AGENT_URL || "http://localhost:8000";

// Reuse the main sales agent at the PydanticAI root — voice is an
// input-modality-only concern and does not need its own backend graph.
const voiceDemoAgent = new HttpAgent({ url: `${AGENT_URL}/` });

/**
 * Transcription service wrapper that reports a clean, typed auth error
 * when OPENAI_API_KEY is not configured.
 *
 * The underlying runtime's `handleTranscribe` categorizes error messages
 * by substring match — in particular, a message containing "api key" or
 * "unauthorized" is mapped to `AUTH_FAILED` (HTTP 401). Throwing here
 * with a deterministic message funnels the missing-key case into that
 * 4xx path instead of leaking an opaque 500/503 through the
 * provider-error fallback.
 *
 * If the key is present we delegate to the real OpenAI-backed service;
 * any upstream Whisper error keeps its natural categorization.
 */
class GuardedOpenAITranscriptionService extends TranscriptionService {
  private delegate: TranscriptionServiceOpenAI | null;

  constructor() {
    super();
    const apiKey = process.env.OPENAI_API_KEY;
    if (apiKey) {
      this.delegate = new TranscriptionServiceOpenAI({
        openai: new OpenAI({ apiKey }),
      });
    } else {
      this.delegate = null;
    }
  }

  async transcribeFile(options: TranscribeFileOptions): Promise<string> {
    if (!this.delegate) {
      // Message includes "api key" so the runtime's error categorizer
      // maps this to AUTH_FAILED → HTTP 401 with a readable body.
      throw new Error(
        "OPENAI_API_KEY not configured for this deployment (api key missing). " +
          "Set OPENAI_API_KEY to enable voice transcription.",
      );
    }
    return this.delegate.transcribeFile(options);
  }
}

// Construct the runtime + transcription service lazily on first request
// so the Next.js build step (which imports and page-data-collects every
// route module) can complete even when OPENAI_API_KEY is not set in the
// Docker build context.
let cachedRuntime: CopilotRuntime | null = null;
function getRuntime(): CopilotRuntime {
  if (cachedRuntime) return cachedRuntime;

  const agents: Record<string, AbstractAgent> = {
    // The page mounts <CopilotKit agent="voice-demo">.
    "voice-demo": voiceDemoAgent,
    default: voiceDemoAgent,
  };

  const runtime = new CopilotRuntime({
    // @ts-ignore -- see main route.ts
    agents,
  });

  // V1 CopilotRuntime's constructor drops `transcriptionService` on the
  // floor (see file header note #1). Write it onto the V2 runtime
  // instance directly so `/info` advertises
  // `audioFileTranscriptionEnabled: true` and so
  // `POST {method: "transcribe"}` has a service to invoke.
  const v2Instance = runtime.instance as unknown as {
    transcriptionService?: TranscriptionService;
  };
  v2Instance.transcriptionService = new GuardedOpenAITranscriptionService();

  cachedRuntime = runtime;
  return cachedRuntime;
}

export const POST = async (req: NextRequest) => {
  try {
    const { handleRequest } = copilotRuntimeNextJSAppRouterEndpoint({
      endpoint: "/api/copilotkit-voice",
      serviceAdapter: new ExperimentalEmptyAdapter(),
      runtime: getRuntime(),
    });
    return await handleRequest(req);
  } catch (error: unknown) {
    const e = error as { message?: string; stack?: string };
    return NextResponse.json(
      { error: e.message, stack: e.stack },
      { status: 500 },
    );
  }
};

// The v2 runtime client tries `GET {runtimeUrl}/info` first and falls
// back to single-route POST on failure. Exporting `GET` here keeps the
// 405 we'd otherwise return from being treated as a server error in
// logs; the v2 auto-detect ignores the 405 and moves on to the working
// POST path.
export const GET = POST;
