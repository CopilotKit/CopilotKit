import type { CopilotKitCoreReact } from "./react-core";
import {
  TranscriptionErrorCode,
  type TranscriptionErrorResponse,
} from "@copilotkitnext/shared";

export interface TranscriptionResult {
  text: string;
  size: number;
  type: string;
}

/**
 * Error info parsed from transcription endpoint error responses.
 */
export interface TranscriptionErrorInfo {
  code: TranscriptionErrorCode;
  message: string;
  retryable: boolean;
}

// Re-export error code enum for convenience
export { TranscriptionErrorCode };

/**
 * Convert a Blob to a base64 string
 */
async function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const result = reader.result as string;
      // Remove the data URL prefix to get pure base64
      const base64 = result.split(",")[1];
      resolve(base64 ?? "");
    };
    reader.onerror = () => reject(new Error("Failed to read audio data"));
    reader.readAsDataURL(blob);
  });
}

/**
 * Check if an error response matches our expected format
 */
function isTranscriptionErrorResponse(
  data: unknown,
): data is TranscriptionErrorResponse {
  return (
    typeof data === "object" &&
    data !== null &&
    "error" in data &&
    "message" in data &&
    typeof (data as TranscriptionErrorResponse).error === "string" &&
    typeof (data as TranscriptionErrorResponse).message === "string"
  );
}

/**
 * Parse error info from a transcription error response
 */
function parseTranscriptionError(
  response: TranscriptionErrorResponse,
): TranscriptionErrorInfo {
  return {
    code: response.error,
    message: response.message,
    retryable: response.retryable ?? false,
  };
}

/**
 * Custom error type for transcription failures.
 * Extends Error with transcription-specific info for contextual error handling.
 */
export class TranscriptionError extends Error {
  public readonly info: TranscriptionErrorInfo;

  constructor(info: TranscriptionErrorInfo) {
    super(info.message);
    this.name = "TranscriptionError";
    this.info = info;
  }
}

/**
 * Transcribe an audio blob using the CopilotKit runtime
 *
 * Supports both REST mode (multipart/form-data) and single-endpoint mode (base64 JSON)
 *
 * @throws {TranscriptionError} When transcription fails with typed error information
 */
export async function transcribeAudio(
  core: CopilotKitCoreReact,
  audioBlob: Blob,
  filename: string = "recording.webm",
): Promise<TranscriptionResult> {
  const runtimeUrl = core.runtimeUrl;
  if (!runtimeUrl) {
    throw new TranscriptionError({
      code: TranscriptionErrorCode.INVALID_REQUEST,
      message: "Runtime URL is not configured",
      retryable: false,
    });
  }

  const headers: Record<string, string> = { ...core.headers };
  let response: Response;

  try {
    if (core.runtimeTransport === "single") {
      // Single-endpoint mode: POST JSON with base64 audio
      const base64Audio = await blobToBase64(audioBlob);

      headers["Content-Type"] = "application/json";

      response = await fetch(runtimeUrl, {
        method: "POST",
        headers,
        body: JSON.stringify({
          method: "transcribe",
          body: {
            audio: base64Audio,
            mimeType: audioBlob.type || "audio/webm",
            filename,
          },
        }),
      });
    } else {
      // REST mode: POST multipart/form-data to /transcribe
      // Don't set Content-Type - browser will set it with boundary for FormData
      delete headers["Content-Type"];

      const formData = new FormData();
      formData.append("audio", audioBlob, filename);

      response = await fetch(`${runtimeUrl}/transcribe`, {
        method: "POST",
        headers,
        body: formData,
      });
    }
  } catch (error) {
    // Network error - fetch failed
    throw new TranscriptionError({
      code: TranscriptionErrorCode.NETWORK_ERROR,
      message:
        error instanceof Error ? error.message : "Network request failed",
      retryable: true,
    });
  }

  if (!response.ok) {
    let errorData: unknown;
    try {
      errorData = await response.json();
    } catch {
      // Could not parse error response
      throw new TranscriptionError({
        code: TranscriptionErrorCode.PROVIDER_ERROR,
        message: `HTTP ${response.status}: ${response.statusText}`,
        retryable: response.status >= 500,
      });
    }

    // If we got a typed error response, use it
    if (isTranscriptionErrorResponse(errorData)) {
      throw new TranscriptionError(parseTranscriptionError(errorData));
    }

    // Unknown error format
    throw new TranscriptionError({
      code: TranscriptionErrorCode.PROVIDER_ERROR,
      message:
        typeof errorData === "object" &&
        errorData !== null &&
        "message" in errorData
          ? String((errorData as { message: unknown }).message)
          : "Transcription failed",
      retryable: response.status >= 500,
    });
  }

  return (await response.json()) as TranscriptionResult;
}
