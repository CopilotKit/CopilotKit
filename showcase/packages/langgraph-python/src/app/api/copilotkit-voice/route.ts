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
// The underlying graph is the same neutral `sample_agent` other chat demos
// use: voice is an input-modality concern, not an agent-behavior concern.
//
// Two non-obvious things this file does:
//
// 1. It bypasses the V1 `CopilotRuntime` wrapper's silent drop of
//    `transcriptionService` by defining the service as an own property on
//    the V2 runtime instance that shadows the prototype's getter-only
//    `transcriptionService` accessor. See
//    `packages/runtime/src/lib/runtime/copilot-runtime.ts` —
//    `transcriptionService` is `Omit`ed from the V1 constructor type and the
//    constructor explicitly does not forward it to the V2 runtime (see the
//    "TODO: add support for transcriptionService" comment there). The V2
//    `CopilotRuntime` class in turn only exposes `transcriptionService` as a
//    getter that reads from a private delegate, so a plain assignment
//    (`instance.transcriptionService = ...`) throws at runtime:
//    "Cannot set property transcriptionService of #<X> which has only a
//    getter". Until the upstream pass-through is fixed, per-demo routes
//    that need transcription must install the service via
//    `Object.defineProperty` so the lookup on the wrapper resolves to our
//    own-property value before it ever reaches the prototype getter.
//
// 2. It always mounts a transcription service (so `/info` advertises the
//    mic-capable state and the composer renders the mic button) but makes
//    the service return a deterministic, human-readable error when
//    OPENAI_API_KEY is not set on the deployment. That keeps the frontend
//    affordance visible while failing loudly with a 4xx instead of a silent
//    503 when the deployment is misconfigured.
//
// References:
// - packages/voice/src/transcription/transcription-service-openai.ts
// - packages/runtime/src/v2/runtime/handlers/handle-transcribe.ts
// - packages/runtime/src/v2/runtime/handlers/get-runtime-info.ts
// - src/app/api/copilotkit-beautiful-chat/route.ts (per-demo route shape)

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import {
  CopilotRuntime,
  ExperimentalEmptyAdapter,
  copilotRuntimeNextJSAppRouterEndpoint,
} from "@copilotkit/runtime";
import { LangGraphAgent } from "@copilotkit/runtime/langgraph";
import { TranscriptionService } from "@copilotkit/runtime/v2";
import type { TranscribeFileOptions } from "@copilotkit/runtime/v2";
import { TranscriptionServiceOpenAI } from "@copilotkit/voice";
import OpenAI from "openai";

const LANGGRAPH_URL =
  process.env.LANGGRAPH_DEPLOYMENT_URL || "http://localhost:8123";

const voiceDemoAgent = new LangGraphAgent({
  deploymentUrl: LANGGRAPH_URL,
  graphId: "sample_agent",
  langsmithApiKey: process.env.LANGSMITH_API_KEY || "",
});

/**
 * Transcription service wrapper that reports a clean, typed auth error when
 * OPENAI_API_KEY is not configured.
 *
 * The underlying runtime's `handleTranscribe` categorizes error messages by
 * substring match — in particular, a message containing "api key" or
 * "unauthorized" is mapped to `AUTH_FAILED` (HTTP 401). Throwing here with a
 * deterministic message funnels the missing-key case into that 4xx path
 * instead of leaking an opaque 500/503 through the provider-error fallback.
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

// Construct the runtime + transcription service lazily on first request so
// the Next.js build step (which imports and page-data-collects every route
// module) can complete even when OPENAI_API_KEY is not set in the Docker
// build context. Whisper calls only fire when the user triggers transcription
// at runtime, where the env var is set (or, if it isn't, the guarded service
// above returns a deterministic 4xx).
let cachedRuntime: CopilotRuntime | null = null;
function getRuntime(): CopilotRuntime {
  if (cachedRuntime) return cachedRuntime;

  const runtime = new CopilotRuntime({
    // @ts-ignore -- see main route.ts: published CopilotRuntime agents type
    // wraps Record in MaybePromise<NonEmptyRecord<...>> which rejects plain
    // Records; fixed in source, pending release.
    agents: {
      // The page mounts <CopilotKit agent="voice-demo">; resolve that to
      // the neutral sample_agent graph.
      "voice-demo": voiceDemoAgent,
      // useAgent() with no args defaults to "default"; alias so any internal
      // default-agent lookups resolve against the same graph.
      default: voiceDemoAgent,
    },
  });

  // V1 CopilotRuntime's constructor drops `transcriptionService` on the floor,
  // and the V2 `CopilotRuntime` wrapper only exposes `transcriptionService` as
  // a getter (no setter) — plain assignment throws
  // "Cannot set property transcriptionService of #<X> which has only a getter".
  // See file header note #1. Use `Object.defineProperty` to install an own
  // data property on the V2 wrapper instance. Own properties take precedence
  // over prototype accessors during property lookup, so `/info` sees
  // `audioFileTranscriptionEnabled: true` and `handleTranscribe` resolves a
  // real service via `runtime.transcriptionService`.
  const v2Instance = runtime.instance as object;
  Object.defineProperty(v2Instance, "transcriptionService", {
    value: new GuardedOpenAITranscriptionService(),
    writable: true,
    configurable: true,
    enumerable: true,
  });

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

// The v2 runtime client tries `GET {runtimeUrl}/info` first and falls back to
// single-route POST on failure. Exporting `GET` here keeps the 405 we'd
// otherwise return from being treated as a server error in logs; the v2
// auto-detect ignores the 405 and moves on to the working POST path.
export const GET = POST;
