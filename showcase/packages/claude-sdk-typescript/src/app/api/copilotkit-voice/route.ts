/**
 * Dedicated runtime for the Voice demo — Claude Agent SDK (TypeScript) port.
 *
 * The voice demo is the only cell that needs `transcriptionService` mounted
 * on its runtime — the presence of that service is what flips
 * `audioFileTranscriptionEnabled: true` on the runtime-info response, which
 * in turn makes the CopilotChat composer render its mic button. Mounting
 * transcription on the shared `/api/copilotkit` route would make every other
 * demo's chat grow a mic button too.
 *
 * Framework-agnostic: the transcription service + guarded auth path are
 * identical to the langgraph-python reference. Only the underlying agent
 * differs — here it's the Claude pass-through, wired via HttpAgent.
 *
 * Two non-obvious things this file does:
 *
 * 1. Writes `transcriptionService` onto the V2 runtime instance directly —
 *    V1 `CopilotRuntime`'s constructor does NOT forward `transcriptionService`
 *    to the V2 runtime (see `packages/runtime/src/lib/runtime/copilot-runtime.ts`
 *    `TODO: add support for transcriptionService`). Until that ships, per-demo
 *    routes that need transcription must reach through `.instance`.
 *
 * 2. Always mounts a guarded service (so `/info` advertises the mic-capable
 *    state even without OPENAI_API_KEY) but throws a typed auth error when
 *    the key is missing, which maps to HTTP 401 instead of an opaque 503.
 */

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

const voiceDemoAgent = new HttpAgent({ url: `${AGENT_URL}/` });

/**
 * Transcription service wrapper that reports a clean, typed auth error when
 * OPENAI_API_KEY is not configured.
 *
 * The underlying runtime's `handleTranscribe` categorizes error messages by
 * substring match — in particular, a message containing "api key" or
 * "unauthorized" is mapped to `AUTH_FAILED` (HTTP 401). Throwing here with
 * a deterministic message funnels the missing-key case into that 4xx path
 * instead of leaking an opaque 500/503 through the provider-error fallback.
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
// the Next.js build step (which imports and page-data-collects every route
// module) can complete even when OPENAI_API_KEY is not set in the Docker
// build context.
let cachedRuntime: CopilotRuntime | null = null;
function getRuntime(): CopilotRuntime {
  if (cachedRuntime) return cachedRuntime;

  const agents: Record<string, AbstractAgent> = {
    "voice-demo": voiceDemoAgent,
    default: voiceDemoAgent,
  };

  const runtime = new CopilotRuntime({
    // @ts-ignore -- see main route.ts
    agents,
  });

  // Write transcriptionService onto the V2 runtime instance directly (V1
  // constructor drops it — see header note).
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

// The v2 runtime client tries `GET {runtimeUrl}/info` first and falls back
// to single-route POST on failure. Exporting `GET` here keeps the 405 we'd
// otherwise return from being treated as a server error in logs.
export const GET = POST;
