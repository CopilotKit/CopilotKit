/**
 * Error codes for transcription HTTP responses.
 * Uses snake_case to align with existing CopilotKitCoreErrorCode pattern.
 * These codes are returned by the runtime and parsed by the client.
 */
export enum TranscriptionErrorCode {
  /** Transcription service not configured in runtime */
  SERVICE_NOT_CONFIGURED = "service_not_configured",
  /** Audio format not supported */
  INVALID_AUDIO_FORMAT = "invalid_audio_format",
  /** Audio file is too long */
  AUDIO_TOO_LONG = "audio_too_long",
  /** Audio file is empty or too short */
  AUDIO_TOO_SHORT = "audio_too_short",
  /** Rate limited by transcription provider */
  RATE_LIMITED = "rate_limited",
  /** Authentication failed with transcription provider */
  AUTH_FAILED = "auth_failed",
  /** Transcription provider returned an error */
  PROVIDER_ERROR = "provider_error",
  /** Network error during transcription */
  NETWORK_ERROR = "network_error",
  /** Invalid request format */
  INVALID_REQUEST = "invalid_request",
}

/**
 * Error response format returned by the transcription endpoint.
 */
export interface TranscriptionErrorResponse {
  error: TranscriptionErrorCode;
  message: string;
  retryable?: boolean;
}

/**
 * Helper functions to create transcription error responses.
 * Used by the runtime to return consistent error responses.
 */
export const TranscriptionErrors = {
  serviceNotConfigured: (): TranscriptionErrorResponse => ({
    error: TranscriptionErrorCode.SERVICE_NOT_CONFIGURED,
    message: "Transcription service is not configured",
    retryable: false,
  }),

  invalidAudioFormat: (
    format: string,
    supported: string[],
  ): TranscriptionErrorResponse => ({
    error: TranscriptionErrorCode.INVALID_AUDIO_FORMAT,
    message: `Unsupported audio format: ${format}. Supported: ${supported.join(", ")}`,
    retryable: false,
  }),

  invalidRequest: (details: string): TranscriptionErrorResponse => ({
    error: TranscriptionErrorCode.INVALID_REQUEST,
    message: details,
    retryable: false,
  }),

  rateLimited: (): TranscriptionErrorResponse => ({
    error: TranscriptionErrorCode.RATE_LIMITED,
    message: "Rate limited. Please try again later.",
    retryable: true,
  }),

  authFailed: (): TranscriptionErrorResponse => ({
    error: TranscriptionErrorCode.AUTH_FAILED,
    message: "Authentication failed with transcription provider",
    retryable: false,
  }),

  providerError: (message: string): TranscriptionErrorResponse => ({
    error: TranscriptionErrorCode.PROVIDER_ERROR,
    message,
    retryable: true,
  }),

  networkError: (
    message: string = "Network error during transcription",
  ): TranscriptionErrorResponse => ({
    error: TranscriptionErrorCode.NETWORK_ERROR,
    message,
    retryable: true,
  }),

  audioTooLong: (): TranscriptionErrorResponse => ({
    error: TranscriptionErrorCode.AUDIO_TOO_LONG,
    message: "Audio file is too long",
    retryable: false,
  }),

  audioTooShort: (): TranscriptionErrorResponse => ({
    error: TranscriptionErrorCode.AUDIO_TOO_SHORT,
    message: "Audio is too short to transcribe",
    retryable: false,
  }),
};
