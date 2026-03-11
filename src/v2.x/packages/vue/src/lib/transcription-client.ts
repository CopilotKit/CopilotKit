import type { CopilotKitCoreVue } from "./vue-core";
import {
  TranscriptionErrorCode,
  type TranscriptionErrorResponse,
} from "@copilotkitnext/shared";

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

export { TranscriptionErrorCode };

async function blobToBase64(blob: Blob): Promise<string> {
  return await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const result = reader.result as string;
      resolve(result.split(",")[1] ?? "");
    };
    reader.onerror = () => reject(new Error("Failed to read audio data"));
    reader.readAsDataURL(blob);
  });
}

function isTranscriptionErrorResponse(data: unknown): data is TranscriptionErrorResponse {
  return (
    typeof data === "object" &&
    data !== null &&
    "error" in data &&
    "message" in data &&
    typeof (data as TranscriptionErrorResponse).error === "string" &&
    typeof (data as TranscriptionErrorResponse).message === "string"
  );
}

function parseTranscriptionError(response: TranscriptionErrorResponse): TranscriptionErrorInfo {
  return {
    code: response.error,
    message: response.message,
    retryable: response.retryable ?? false,
  };
}

export class TranscriptionError extends Error {
  public readonly info: TranscriptionErrorInfo;

  constructor(info: TranscriptionErrorInfo) {
    super(info.message);
    this.name = "TranscriptionError";
    this.info = info;
  }
}

export async function transcribeAudio(
  core: CopilotKitCoreVue,
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
    throw new TranscriptionError({
      code: TranscriptionErrorCode.NETWORK_ERROR,
      message: error instanceof Error ? error.message : "Network request failed",
      retryable: true,
    });
  }

  if (!response.ok) {
    let errorData: unknown;
    try {
      errorData = await response.json();
    } catch {
      throw new TranscriptionError({
        code: TranscriptionErrorCode.PROVIDER_ERROR,
        message: `HTTP ${response.status}: ${response.statusText}`,
        retryable: response.status >= 500,
      });
    }

    if (isTranscriptionErrorResponse(errorData)) {
      throw new TranscriptionError(parseTranscriptionError(errorData));
    }

    throw new TranscriptionError({
      code: TranscriptionErrorCode.PROVIDER_ERROR,
      message:
        typeof errorData === "object" && errorData !== null && "message" in errorData
          ? String((errorData as { message: unknown }).message)
          : "Transcription failed",
      retryable: response.status >= 500,
    });
  }

  return (await response.json()) as TranscriptionResult;
}
