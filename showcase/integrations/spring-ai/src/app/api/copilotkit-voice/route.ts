// Dedicated runtime for the Voice demo.
//
// Voice is an INPUT MODALITY concern handled in the NextJS runtime — not
// the Spring-AI Java backend. The runtime mounts a transcription service so
// `audioFileTranscriptionEnabled: true` flips on the probe response and
// CopilotChat renders its microphone button. The transcribed text is then
// sent as a plain message to the same Spring-AI ChatClient the other demos
// use, via HttpAgent.
//
// Scoped to its own route so other demos don't pay the cost of the
// transcription plumbing and don't grow an unexpected mic button.
//
// Two non-obvious things this file does (mirroring the upstream
// langgraph-python showcase fix from CopilotKit#4271):
//
// 1. It bypasses the V1 `CopilotRuntime` wrapper's silent drop of
//    `transcriptionService` by writing the service onto the V2 runtime
//    instance directly. See
//    `packages/runtime/src/lib/runtime/copilot-runtime.ts` — the V1 wrapper
//    `Omit`s `transcriptionService` from its constructor type and does not
//    forward it to the V2 runtime. Until that is unblocked upstream, per-demo
//    routes that need transcription must reach through `.instance`.
//
// 2. It always mounts a transcription service (so `/info` advertises the
//    mic-capable state and the composer renders the mic button) but makes
//    the service return a deterministic, human-readable error when
//    `OPENAI_API_KEY` is not set on the deployment. The runtime's error
//    categorizer maps messages containing "api key" or "unauthorized" to
//    `AUTH_FAILED → 401`, so a misconfigured deployment returns a clean 4xx
//    instead of an opaque 503.
//
// References:
// - packages/voice/src/transcription/transcription-service-openai.ts
// - packages/runtime/src/v2/runtime/handlers/handle-transcribe.ts
// - packages/runtime/src/v2/runtime/handlers/get-runtime-info.ts

import { NextRequest, NextResponse } from "next/server";
import {
  CopilotRuntime,
  ExperimentalEmptyAdapter,
  copilotRuntimeNextJSAppRouterEndpoint,
} from "@copilotkit/runtime";
import { TranscriptionService } from "@copilotkit/runtime/v2";
import type { TranscribeFileOptions } from "@copilotkit/runtime/v2";
import { AbstractAgent, HttpAgent } from "@ag-ui/client";
import { TranscriptionServiceOpenAI } from "@copilotkit/voice";
import OpenAI from "openai";

const AGENT_URL = process.env.AGENT_URL || "http://localhost:8000";

function createAgent(): AbstractAgent {
  return new HttpAgent({ url: `${AGENT_URL}/` });
}

/**
 * Transcription service wrapper that reports a clean, typed auth error when
 * `OPENAI_API_KEY` is not configured.
 *
 * The underlying runtime's `handleTranscribe` categorizes error messages by
 * substring match — a message containing "api key" or "unauthorized" is
 * mapped to `AUTH_FAILED` (HTTP 401). Throwing here with a deterministic
 * message funnels the missing-key case into that 4xx path instead of leaking
 * an opaque 500/503 through the provider-error fallback.
 *
 * If the key is present we delegate to the real OpenAI-backed service; any
 * upstream Whisper error keeps its natural categorization.
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
      // Message includes "api key" so the runtime's error categorizer maps
      // this to AUTH_FAILED → HTTP 401 with a readable body. This is the
      // intended 4xx path for a misconfigured deployment.
      throw new Error(
        "OPENAI_API_KEY not configured for this deployment (api key missing). " +
          "Set OPENAI_API_KEY to enable voice transcription.",
      );
    }
    return this.delegate.transcribeFile(options);
  }
}

// Lazy-init so the NextJS build step doesn't crash when OPENAI_API_KEY is
// not set in the Docker build context. Whisper calls only fire at runtime.
let cachedRuntime: CopilotRuntime | null = null;
function getRuntime(): CopilotRuntime {
  if (cachedRuntime) return cachedRuntime;

  const voiceAgent = createAgent();
  const agents: Record<string, AbstractAgent> = {
    "voice-demo": voiceAgent,
    default: voiceAgent,
  };
  const runtime = new CopilotRuntime({
    // @ts-ignore -- see main route.ts
    agents,
  });

  // V1 CopilotRuntime's constructor silently drops `transcriptionService`
  // (it's `Omit`ed from the V1 options type and not forwarded to the V2
  // runtime). Write the service onto the V2 runtime instance directly so
  // `/info` advertises `audioFileTranscriptionEnabled: true` and so
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
