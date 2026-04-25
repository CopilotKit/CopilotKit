// Dedicated runtime for the Voice demo.
//
// This is the only demo that needs `transcriptionService` mounted on
// the V2 runtime — its presence flips `audioFileTranscriptionEnabled:
// true` on the runtime-info response, which is what makes the
// CopilotChat composer render its mic button. Mounting transcription on
// the shared `/api/copilotkit` route would make every other demo grow a
// mic button too; scoping it here keeps the affordance exactly where
// the demo promises it.
//
// The underlying graph is the same neutral Claude backend other chat
// demos use — voice is an input-modality concern, not an agent-behavior
// concern. So the HttpAgent here points back at the shared `/` endpoint
// on the Python server, not a dedicated one.
//
// Two non-obvious things this file does (mirroring the langgraph-python
// reference route, which has the same framework-agnostic concerns):
//
// 1. It bypasses the V1 `CopilotRuntime` wrapper's silent drop of
//    `transcriptionService` by writing the service onto the V2 runtime
//    instance directly. See
//    `packages/runtime/src/lib/runtime/copilot-runtime.ts` — the V1
//    constructor explicitly does not forward `transcriptionService` to
//    the V2 runtime. Until that is unblocked upstream, per-demo routes
//    that need transcription must reach through `.instance`.
//
// 2. It always mounts a transcription service (so `/info` advertises
//    the mic-capable state) but the service returns a deterministic,
//    human-readable error when `OPENAI_API_KEY` is not set on the
//    deployment. The runtime's error categorizer maps messages
//    containing "api key" to `AUTH_FAILED` → HTTP 401, which is the
//    intended 4xx path for a misconfigured deployment — much better
//    than a silent 503 through the provider-error fallback.

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
 * Transcription service wrapper that reports a clean, typed auth error
 * when `OPENAI_API_KEY` is not configured.
 *
 * See file header note #2 for why this is the preferred error surface.
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
      // Message contains "api key" so the runtime's categorizer maps
      // it to AUTH_FAILED → HTTP 401 with a readable body.
      throw new Error(
        "OPENAI_API_KEY not configured for this deployment (api key missing). " +
          "Set OPENAI_API_KEY to enable voice transcription.",
      );
    }
    return this.delegate.transcribeFile(options);
  }
}

// Lazily construct the runtime + transcription service on first
// request. Next.js build-time page-data collection imports every route
// module; deferring construction keeps OPENAI_API_KEY out of the build
// context and makes Docker builds in CI work even when the key is only
// available at runtime.
let cachedRuntime: CopilotRuntime | null = null;
function getRuntime(): CopilotRuntime {
  if (cachedRuntime) return cachedRuntime;

  const agent = createAgent();
  const agents: Record<string, AbstractAgent> = {
    "voice-demo": agent,
    // useAgent() with no args defaults to "default"; alias so internal
    // default-agent lookups resolve against the same graph.
    default: agent,
  };

  const runtime = new CopilotRuntime({
    // @ts-ignore -- see main route.ts
    agents,
  });

  // V1 CopilotRuntime drops `transcriptionService` on the floor — write
  // it onto the V2 runtime instance directly.
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

// The V2 runtime client tries `GET {runtimeUrl}/info` first and falls
// back to single-route POST on failure. Exporting GET here keeps the
// 405 we'd otherwise return from being treated as a server error in
// logs; the V2 auto-detect ignores the 405 and moves on to the working
// POST path.
export const GET = POST;
