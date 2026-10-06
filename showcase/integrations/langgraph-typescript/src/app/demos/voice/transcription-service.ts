// Canonical source; materialized into each selected integration by
// showcase/scripts/sync-shared-frontends.ts.
//
// Server-only transcription service for the voice demo's runtime route
// (`src/app/api/copilotkit-voice/[[...slug]]/route.ts`). It sits beside the
// demo page so its source ships with the voice cell.
//
// One transcription policy for every integration that imports this file:
//
// - Voice needs its own credential, `OPENAI_TRANSCRIPTION_API_KEY`. Without
//   it `createTranscriptionService` returns `undefined`, the route omits
//   `transcriptionService`, `/info` reports
//   `audioFileTranscriptionEnabled: false` (so the chat hides the mic), and
//   `/transcribe` answers 503 `service_not_configured`. The chat key
//   (`OPENAI_API_KEY`) never enables voice: deployments point chat at AIMock
//   with a placeholder key.
// - Recorded audio goes to real OpenAI (`https://api.openai.com/v1`). It never
//   inherits `OPENAI_BASE_URL` or `AIMOCK_URL`. Local docker and Railway point
//   those at AIMock so chat stays deterministic, but AIMock answers
//   transcription from fixtures without reading the audio, and its proxy mode
//   corrupts multipart audio on the way to OpenAI.
// - `OPENAI_TRANSCRIPTION_BASE_URL` is the only override. A fixture or harness
//   run that wants AIMock transcripts must set it explicitly (for example
//   `http://localhost:4010/v1`).
// - An empty (0-byte) upload is rejected before any provider call, so it can
//   never come back with a fixture transcript.

// @region[transcription-service-guard]
import { TranscriptionService } from "@copilotkit/runtime/v2";
import type { TranscribeFileOptions } from "@copilotkit/runtime/v2";
import { TranscriptionServiceOpenAI } from "@copilotkit/voice";
import { OpenAI } from "openai";

const OPENAI_TRANSCRIPTION_URL = "https://api.openai.com/v1";

type TranscriptionEnv = Record<string, string | undefined>;

/** Rejects empty recordings before they reach the provider. */
class NonEmptyAudioTranscriptionService extends TranscriptionService {
  constructor(private readonly delegate: TranscriptionServiceOpenAI) {
    super();
  }

  async transcribeFile(options: TranscribeFileOptions): Promise<string> {
    if (options.audioFile.size === 0) {
      throw new Error(
        "Audio upload is empty (0 bytes); nothing was sent for transcription.",
      );
    }
    return this.delegate.transcribeFile(options);
  }
}

/**
 * Returns a transcription service only when the dedicated credential is set.
 * Pass the result straight to `CopilotRuntime`: `undefined` hides the mic and
 * makes `/transcribe` answer 503.
 */
export function createTranscriptionService(
  env: TranscriptionEnv = process.env,
): TranscriptionService | undefined {
  const apiKey = env.OPENAI_TRANSCRIPTION_API_KEY?.trim();
  if (!apiKey) return undefined;

  return new NonEmptyAudioTranscriptionService(
    new TranscriptionServiceOpenAI({
      openai: new OpenAI({
        apiKey,
        baseURL:
          env.OPENAI_TRANSCRIPTION_BASE_URL?.trim() || OPENAI_TRANSCRIPTION_URL,
      }),
    }),
  );
}
// @endregion[transcription-service-guard]
