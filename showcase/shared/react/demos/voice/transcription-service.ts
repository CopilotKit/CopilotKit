// Canonical source; materialized into each selected integration by
// showcase/scripts/sync-shared-frontends.ts.
//
// Server-only transcription service for the voice demo's runtime route
// (`src/app/api/copilotkit-voice/[[...slug]]/route.ts`). It sits beside the
// demo page so its source ships with the voice cell.
//
// One transcription policy for every integration that imports this file:
//
// - Recorded audio goes to real OpenAI (`https://api.openai.com/v1`). It never
//   inherits `OPENAI_BASE_URL` or `AIMOCK_URL`. Local docker and Railway point
//   those at AIMock so chat stays deterministic, but AIMock answers
//   transcription from fixtures without reading the audio, and its proxy mode
//   corrupts multipart audio on the way to OpenAI. Inheriting them would give
//   a real recording a canned transcript or a 502.
// - `OPENAI_TRANSCRIPTION_BASE_URL` is the only override. A fixture or harness
//   run that wants AIMock transcripts must set it explicitly (for example
//   `http://localhost:4010/v1`).
// - `OPENAI_API_KEY` is required. Without it `/transcribe` answers 401
//   `auth_failed` before any provider call.
// - An empty (0-byte) upload is rejected before any provider call, so it can
//   never come back with a fixture transcript.

// @region[transcription-service-guard]
import { TranscriptionService } from "@copilotkit/runtime/v2";
import type { TranscribeFileOptions } from "@copilotkit/runtime/v2";
import { TranscriptionServiceOpenAI } from "@copilotkit/voice";
import OpenAI from "openai";

const OPENAI_API_BASE_URL = "https://api.openai.com/v1";

type TranscriptionEnv = Record<string, string | undefined>;

/** Where recorded audio is sent: OpenAI unless explicitly overridden. */
export function resolveTranscriptionBaseUrl(
  env: TranscriptionEnv = process.env,
): string {
  return env.OPENAI_TRANSCRIPTION_BASE_URL?.trim() || OPENAI_API_BASE_URL;
}

/**
 * Delegates to the OpenAI-backed service from `@copilotkit/voice`, and fails
 * with a typed error instead of an opaque SDK error when it can't transcribe.
 * The V2 runtime maps error text containing "api key" to `auth_failed` (401).
 */
export class GuardedOpenAITranscriptionService extends TranscriptionService {
  private readonly delegate: TranscriptionServiceOpenAI | null;

  constructor(env: TranscriptionEnv = process.env) {
    super();
    const apiKey = env.OPENAI_API_KEY?.trim();
    this.delegate = apiKey
      ? new TranscriptionServiceOpenAI({
          openai: new OpenAI({
            apiKey,
            baseURL: resolveTranscriptionBaseUrl(env),
          }),
        })
      : null;
  }

  async transcribeFile(options: TranscribeFileOptions): Promise<string> {
    if (!this.delegate) {
      const message =
        "OPENAI_API_KEY is not set (api key missing), so voice " +
        "transcription is unavailable. Set OPENAI_API_KEY to enable it.";
      console.error(`[voice] ${message}`);
      throw new Error(message);
    }
    if (options.audioFile.size === 0) {
      throw new Error(
        "Audio upload is empty (0 bytes); nothing was sent for transcription.",
      );
    }
    return this.delegate.transcribeFile(options);
  }
}
// @endregion[transcription-service-guard]
