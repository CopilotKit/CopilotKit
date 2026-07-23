import type { CopilotKitCore } from "@copilotkit/core";
import {
  TranscriptionErrorCode,
  type TranscriptionErrorResponse,
} from "@copilotkit/shared";

export { TranscriptionErrorCode };

export interface TranscriptionResult {
  text: string;
  size: number;
  type: string;
}

export interface TranscriptionErrorInfo {
  code: TranscriptionErrorCode;
  message: string;
  retryable: boolean;
}

export class TranscriptionError extends Error {
  readonly info: TranscriptionErrorInfo;

  constructor(info: TranscriptionErrorInfo) {
    super(info.message);
    this.name = "TranscriptionError";
    this.info = info;
  }
}

/**
 * Transcribe an audio blob via the CopilotKit runtime. Uses single-endpoint
 * (base64 JSON) or REST (multipart `/transcribe`) mode to match the transport
 * configured on the core.
 *
 * @throws {TranscriptionError} with typed error info on any failure.
 */
export async function transcribeAudio(
  core: CopilotKitCore,
  audioBlob: Blob,
  filename = "recording.webm",
): Promise<TranscriptionResult> {
  const { runtimeUrl } = core;
  if (!runtimeUrl) {
    throw new TranscriptionError({
      code: TranscriptionErrorCode.INVALID_REQUEST,
      message: "Runtime URL is not configured",
      retryable: false,
    });
  }

  let response: Response;
  try {
    response =
      core.runtimeTransport === "single"
        ? await fetch(runtimeUrl, {
            method: "POST",
            headers: { ...core.headers, "Content-Type": "application/json" },
            body: JSON.stringify({
              method: "transcribe",
              body: {
                audio: await blobToBase64(audioBlob),
                mimeType: audioBlob.type || "audio/webm",
                filename,
              },
            }),
          })
        : await fetch(`${runtimeUrl}/transcribe`, {
            method: "POST",
            // No Content-Type: the browser sets it (with boundary) for FormData.
            headers: omitContentType(core.headers),
            body: toFormData(audioBlob, filename),
          });
  } catch (error) {
    throw new TranscriptionError({
      code: TranscriptionErrorCode.NETWORK_ERROR,
      message:
        error instanceof Error ? error.message : "Network request failed",
      retryable: true,
    });
  }

  if (!response.ok) {
    throw await toTranscriptionError(response);
  }

  return (await response.json()) as TranscriptionResult;
}

function toFormData(audioBlob: Blob, filename: string): FormData {
  const formData = new FormData();
  formData.append("audio", audioBlob, filename);
  return formData;
}

function omitContentType(
  headers: Readonly<Record<string, string>>,
): Record<string, string> {
  const result = { ...headers };
  delete result["Content-Type"];
  return result;
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      // Strip the `data:...;base64,` prefix to get the raw base64 payload.
      const result = reader.result as string;
      resolve(result.slice(result.indexOf(",") + 1));
    };
    reader.onerror = () => reject(new Error("Failed to read audio data"));
    reader.readAsDataURL(blob);
  });
}

/** Build a typed error from a non-OK transcription response. */
async function toTranscriptionError(
  response: Response,
): Promise<TranscriptionError> {
  const retryable = response.status >= 500;

  let data: unknown;
  try {
    data = await response.json();
  } catch {
    return new TranscriptionError({
      code: TranscriptionErrorCode.PROVIDER_ERROR,
      message: `HTTP ${response.status}: ${response.statusText}`,
      retryable,
    });
  }

  if (isTranscriptionErrorResponse(data)) {
    return new TranscriptionError({
      code: data.error,
      message: data.message,
      retryable: data.retryable ?? false,
    });
  }

  const message =
    typeof data === "object" && data !== null && "message" in data
      ? String((data as { message: unknown }).message)
      : "Transcription failed";

  return new TranscriptionError({
    code: TranscriptionErrorCode.PROVIDER_ERROR,
    message,
    retryable,
  });
}

function isTranscriptionErrorResponse(
  data: unknown,
): data is TranscriptionErrorResponse {
  return (
    typeof data === "object" &&
    data !== null &&
    typeof (data as TranscriptionErrorResponse).error === "string" &&
    typeof (data as TranscriptionErrorResponse).message === "string"
  );
}
