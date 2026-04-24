// Dedicated runtime for the Voice demo.
//
// The voice cell is the only one that mounts `transcriptionService` — this
// flips `audioFileTranscriptionEnabled: true` on the runtime-info response
// and makes the mic button appear on the CopilotChat composer. Keeping this
// scoped prevents the mic button from leaking into every other chat demo.
//
// Lazy construction so the Next.js build does not require OPENAI_API_KEY at
// build time; Whisper calls only fire at runtime when the user triggers
// transcription.

import { NextRequest, NextResponse } from "next/server";
import {
  CopilotRuntime,
  ExperimentalEmptyAdapter,
  copilotRuntimeNextJSAppRouterEndpoint,
} from "@copilotkit/runtime";
import { HttpAgent } from "@ag-ui/client";
import { TranscriptionServiceOpenAI } from "@copilotkit/voice";
import OpenAI from "openai";

const AGENT_URL = process.env.AGENT_URL || "http://localhost:8000";

function createAgent() {
  return new HttpAgent({ url: `${AGENT_URL}/` });
}

const voiceDemoAgent = createAgent();

let cachedRuntime: CopilotRuntime | null = null;
function getRuntime(): CopilotRuntime {
  if (cachedRuntime) return cachedRuntime;
  const transcriptionService = new TranscriptionServiceOpenAI({
    openai: new OpenAI({ apiKey: process.env.OPENAI_API_KEY }),
  });
  cachedRuntime = new CopilotRuntime({
    // @ts-ignore -- Published CopilotRuntime agents type wraps Record in MaybePromise<NonEmptyRecord<...>>; HttpAgent is structurally compatible with AbstractAgent but misses the private `_debug*` fields in the published .d.ts. Mirrors the main route's ts-ignore.
    agents: {
      // @ts-ignore
      "voice-demo": voiceDemoAgent,
      // @ts-ignore
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
