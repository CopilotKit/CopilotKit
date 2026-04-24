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
// The underlying agent is the same neutral SalesAgent the shared runtime
// uses — voice is an input-modality concern, not an agent-behavior concern.
//
// References:
// - packages/voice/src/transcription/transcription-service-openai.ts
// - packages/runtime/src/v2/runtime/handlers/handle-transcribe.ts

import { NextRequest, NextResponse } from "next/server";
import {
  CopilotRuntime,
  ExperimentalEmptyAdapter,
  copilotRuntimeNextJSAppRouterEndpoint,
} from "@copilotkit/runtime";
import { AbstractAgent, HttpAgent } from "@ag-ui/client";
import { TranscriptionServiceOpenAI } from "@copilotkit/voice";
import OpenAI from "openai";

const AGENT_URL = process.env.AGENT_URL || "http://localhost:8000";

function createAgent() {
  return new HttpAgent({ url: `${AGENT_URL}/` });
}

// Construct the OpenAI client + runtime lazily on first request so the
// Next.js build step (which imports and page-data-collects every route
// module) can complete even when OPENAI_API_KEY is not set in the Docker
// build context. Whisper calls only fire when the user triggers
// transcription at runtime, where the env var is set.
let cachedRuntime: CopilotRuntime | null = null;
function getRuntime(): CopilotRuntime {
  if (cachedRuntime) return cachedRuntime;

  const transcriptionService = new TranscriptionServiceOpenAI({
    openai: new OpenAI({ apiKey: process.env.OPENAI_API_KEY }),
  });

  const agents: Record<string, AbstractAgent> = {
    // The page mounts <CopilotKit agent="voice-demo">; resolve that to the
    // neutral SalesAgent on the .NET backend.
    "voice-demo": createAgent(),
    // useAgent() with no args defaults to "default"; alias so any internal
    // default-agent lookups resolve against the same agent.
    default: createAgent(),
  };

  cachedRuntime = new CopilotRuntime({
    // @ts-ignore -- Published CopilotRuntime agents type wraps Record in
    // MaybePromise<NonEmptyRecord<...>> which rejects plain Records; fixed in
    // source, pending release.
    agents,
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
