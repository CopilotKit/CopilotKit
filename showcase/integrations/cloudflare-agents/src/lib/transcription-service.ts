// @region[transcription-service-guard]
import { TranscriptionServiceOpenAI } from "@copilotkit/voice";
import { OpenAI } from "openai";
import { probeHeaderFetch } from "@/lib/cloudflare-agents";

const OPENAI_TRANSCRIPTION_URL = "https://api.openai.com/v1";

export function createTranscriptionService(
  env: NodeJS.ProcessEnv = process.env,
): TranscriptionServiceOpenAI | undefined {
  const apiKey = env.OPENAI_TRANSCRIPTION_API_KEY;
  if (!apiKey) return undefined;

  return new TranscriptionServiceOpenAI({
    openai: new OpenAI({
      apiKey,
      baseURL: env.OPENAI_TRANSCRIPTION_BASE_URL ?? OPENAI_TRANSCRIPTION_URL,
      // The probe's aimock headers, for test stacks that point
      // OPENAI_TRANSCRIPTION_BASE_URL at aimock.
      fetch: probeHeaderFetch,
    }),
  });
}
// @endregion[transcription-service-guard]
