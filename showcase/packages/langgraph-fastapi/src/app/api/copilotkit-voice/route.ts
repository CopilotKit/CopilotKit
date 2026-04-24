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
// References:
// - packages/voice/src/transcription/transcription-service-openai.ts
// - packages/runtime/src/v2/runtime/handlers/handle-transcribe.ts
// - src/app/api/copilotkit-beautiful-chat/route.ts (per-demo route shape)

import { NextRequest, NextResponse } from "next/server";
import {
  CopilotRuntime,
  ExperimentalEmptyAdapter,
  copilotRuntimeNextJSAppRouterEndpoint,
} from "@copilotkit/runtime";
import { LangGraphAgent } from "@copilotkit/runtime/langgraph";
import { TranscriptionServiceOpenAI } from "@copilotkit/voice";
import OpenAI from "openai";

const AGENT_URL = process.env.AGENT_URL || "http://localhost:8123";

const voiceDemoAgent = new LangGraphAgent({
  deploymentUrl: `${AGENT_URL}/`,
  graphId: "sample_agent",
});

// Construct the OpenAI client + runtime lazily on first request so the
// Next.js build step (which imports and page-data-collects every route
// module) can complete even when OPENAI_API_KEY is not set in the Docker
// build context. Whisper calls only fire when the user triggers
// transcription at runtime on Railway, where the env var is set.
let cachedRuntime: CopilotRuntime | null = null;
function getRuntime(): CopilotRuntime {
  if (cachedRuntime) return cachedRuntime;
  const transcriptionService = new TranscriptionServiceOpenAI({
    openai: new OpenAI({ apiKey: process.env.OPENAI_API_KEY }),
  });
  cachedRuntime = new CopilotRuntime({
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
    transcriptionService,
  });
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
