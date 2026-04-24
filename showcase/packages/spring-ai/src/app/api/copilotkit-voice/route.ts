// Dedicated runtime for the Voice demo.
//
// Voice is an INPUT MODALITY concern handled in the NextJS runtime — not
// the Spring-AI Java backend. The runtime mounts `TranscriptionServiceOpenAI`
// so `audioFileTranscriptionEnabled: true` flips on the probe response and
// CopilotChat renders its microphone button. The transcribed text is then
// sent as a plain message to the same Spring-AI ChatClient the other demos
// use, via HttpAgent.
//
// Scoped to its own route so other demos don't pay the cost of the
// transcription plumbing and don't grow an unexpected mic button.

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

function createAgent(): AbstractAgent {
  return new HttpAgent({ url: `${AGENT_URL}/` });
}

// Lazy-init so the NextJS build step doesn't crash when OPENAI_API_KEY is
// not set in the Docker build context. Whisper calls only fire at runtime.
let cachedRuntime: CopilotRuntime | null = null;
function getRuntime(): CopilotRuntime {
  if (cachedRuntime) return cachedRuntime;
  const transcriptionService = new TranscriptionServiceOpenAI({
    openai: new OpenAI({ apiKey: process.env.OPENAI_API_KEY }),
  });
  const voiceAgent = createAgent();
  const agents: Record<string, AbstractAgent> = {
    "voice-demo": voiceAgent,
    default: voiceAgent,
  };
  cachedRuntime = new CopilotRuntime({
    // @ts-ignore -- see main route.ts
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
