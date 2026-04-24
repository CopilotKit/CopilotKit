// Dedicated runtime for the Voice demo.
//
// The voice demo is the only cell that needs `transcriptionService` mounted
// on its runtime — the presence of that service is what flips
// `audioFileTranscriptionEnabled: true` on the runtime-info response, which
// in turn makes the CopilotChat composer render its mic button. Mounting
// transcription on the shared `/api/copilotkit` route would make every other
// demo's chat grow a mic button too. Scoping it to this per-demo route keeps
// the mic UI exactly where the spec promises it.
//
// The underlying agent is the shared MS Agent Framework agent at the backend
// root path (`/`); voice is an input-modality concern, not an agent-behavior
// concern, so we reuse the existing backend.
//
// Two non-obvious things this file does:
//
// 1. It bypasses the V1 `CopilotRuntime` wrapper's silent drop of
//    `transcriptionService` by writing the service onto the V2 runtime
//    instance directly. `transcriptionService` is `Omit`ed from the V1
//    constructor type and the constructor does not forward it to V2.
//    Until that is unblocked upstream, per-demo routes that need
//    transcription must reach through `.instance`.
//
// 2. It always mounts a transcription service (so `/info` advertises the
//    mic-capable state and the composer renders the mic button) but makes
//    the service return a deterministic, human-readable error when
//    OPENAI_API_KEY is not set. That keeps the frontend affordance visible
//    while failing loudly with 401 instead of silently 503-ing.
//
// References:
// - packages/voice/src/transcription/transcription-service-openai.ts
// - packages/runtime/src/v2/runtime/handlers/handle-transcribe.ts
// - packages/runtime/src/v2/runtime/handlers/get-runtime-info.ts

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import {
  CopilotRuntime,
  ExperimentalEmptyAdapter,
  copilotRuntimeNextJSAppRouterEndpoint,
} from "@copilotkit/runtime";
import { AbstractAgent, HttpAgent } from "@ag-ui/client";
import { TranscriptionService } from "@copilotkit/runtime/v2";
import type { TranscribeFileOptions } from "@copilotkit/runtime/v2";
import { TranscriptionServiceOpenAI } from "@copilotkit/voice";
import OpenAI from "openai";

const AGENT_URL = process.env.AGENT_URL || "http://localhost:8000";

function createAgent() {
  return new HttpAgent({ url: `${AGENT_URL}/` });
}

/**
 * Transcription service wrapper that reports a clean, typed auth error when
 * OPENAI_API_KEY is not configured.
 *
 * The runtime's `handleTranscribe` categorizes error messages by substring
 * match — a message containing "api key" or "unauthorized" maps to
 * `AUTH_FAILED` (HTTP 401). Throwing here with a deterministic message
 * funnels the missing-key case into that 4xx path instead of leaking an
 * opaque 500/503.
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
      throw new Error(
        "OPENAI_API_KEY not configured for this deployment (api key missing). " +
          "Set OPENAI_API_KEY to enable voice transcription.",
      );
    }
    return this.delegate.transcribeFile(options);
  }
}

// Construct the runtime + transcription service lazily on first request so
// the Next.js build step can complete even when OPENAI_API_KEY is not set.
// Whisper calls only fire at runtime where the env var is set (or, if it
// isn't, the guarded service returns a deterministic 4xx).
let cachedRuntime: CopilotRuntime | null = null;
function getRuntime(): CopilotRuntime {
  if (cachedRuntime) return cachedRuntime;

  const agents: Record<string, AbstractAgent> = {
    // The page mounts <CopilotKit agent="voice-demo">; resolve to the
    // shared backend agent.
    "voice-demo": createAgent(),
    // useAgent() with no args defaults to "default"; alias so any internal
    // default-agent lookups resolve against the same agent.
    default: createAgent(),
  };

  const runtime = new CopilotRuntime({
    // @ts-ignore -- Published CopilotRuntime agents type wraps Record in
    // MaybePromise<NonEmptyRecord<...>> which rejects plain Records; fixed
    // in source, pending release.
    agents,
  });

  // V1 CopilotRuntime's constructor drops `transcriptionService` on the floor.
  // Write it onto the V2 runtime instance directly so `/info` advertises
  // `audioFileTranscriptionEnabled: true` and `POST {method: "transcribe"}`
  // has a service to invoke.
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

export const GET = POST;
