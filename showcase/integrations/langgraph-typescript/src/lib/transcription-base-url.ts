type TranscriptionEnvironment = Pick<
  NodeJS.ProcessEnv,
  "AIMOCK_URL" | "OPENAI_TRANSCRIPTION_BASE_URL"
>;

const OPENAI_TRANSCRIPTIONS_URL = "https://api.openai.com/v1";

/**
 * Keep real deployments on OpenAI unless a transcription-specific endpoint is
 * configured. Local AIMock runs opt in through AIMOCK_URL, which is normally
 * a bare origin while the OpenAI client requires its /v1 API prefix.
 */
export function resolveTranscriptionBaseUrl(
  env: TranscriptionEnvironment = process.env,
): string {
  if (env.OPENAI_TRANSCRIPTION_BASE_URL) {
    return env.OPENAI_TRANSCRIPTION_BASE_URL;
  }

  if (env.AIMOCK_URL) {
    const aimockOrigin = env.AIMOCK_URL.replace(/\/+$/, "").replace(
      /\/v1$/,
      "",
    );
    return `${aimockOrigin}/v1`;
  }

  return OPENAI_TRANSCRIPTIONS_URL;
}
