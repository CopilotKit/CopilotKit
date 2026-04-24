// Dedicated runtime for the Voice demo.
//
// The voice demo is the only cell that needs `transcriptionService` mounted
// on its runtime — the presence of that service is what flips
// `audioFileTranscriptionEnabled: true` on the runtime-info response, which
// in turn makes the CopilotChat composer render its mic button. Mounting
// transcription on the shared `/api/copilotkit` route would make every other
// demo's chat grow a mic button too. Scoping it here keeps the mic UI where
// the spec promises it.

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

const voiceDemoAgent = new HttpAgent({ url: `${AGENT_URL}/run` });

// Construct the OpenAI client + runtime lazily on first request so the
// Next.js build step (which imports every route module) can complete even
// when OPENAI_API_KEY is not set in the build context.
let cachedRuntime: CopilotRuntime | null = null;
function getRuntime(): CopilotRuntime {
  if (cachedRuntime) return cachedRuntime;
  const transcriptionService = new TranscriptionServiceOpenAI({
    openai: new OpenAI({ apiKey: process.env.OPENAI_API_KEY }),
  });
  cachedRuntime = new CopilotRuntime({
    // @ts-ignore -- see main route.ts
    agents: {
      "voice-demo": voiceDemoAgent as AbstractAgent,
      default: voiceDemoAgent as AbstractAgent,
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
