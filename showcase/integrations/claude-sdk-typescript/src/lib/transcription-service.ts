// @region[transcription-service-guard]
import { TranscriptionServiceOpenAI } from "@copilotkit/voice";
import { OpenAI } from "openai";

const OPENAI_TRANSCRIPTION_URL = "https://api.openai.com/v1";

// @copilotkit/voice currently bundles its own OpenAI package copy. The
// runtime client shape is compatible, but OpenAI's private fields make
// TypeScript treat the two package instances nominally.
type VoiceOpenAI = ConstructorParameters<
  typeof TranscriptionServiceOpenAI
>[0]["openai"];

export function createTranscriptionService(
  env: NodeJS.ProcessEnv = process.env,
): TranscriptionServiceOpenAI | undefined {
  const apiKey = env.OPENAI_TRANSCRIPTION_API_KEY;
  if (!apiKey) return undefined;

  return new TranscriptionServiceOpenAI({
    openai: new OpenAI({
      apiKey,
      baseURL: env.OPENAI_TRANSCRIPTION_BASE_URL ?? OPENAI_TRANSCRIPTION_URL,
    }) as unknown as VoiceOpenAI,
  });
}
// @endregion[transcription-service-guard]
