import { TranscriptionErrorCode } from "@copilotkit/shared";
import type { TranscriptionErrorResponse } from "@copilotkit/shared";
import type { CopilotKitCore } from "../core/core";

export { TranscriptionErrorCode };

/** The text the runtime returned for one recording. */
export interface TranscriptionResult {
  text: string;
  size: number;
  type: string;
}

/** Why a transcription failed, and whether trying again can help. */
export interface TranscriptionErrorInfo {
  code: TranscriptionErrorCode;
  message: string;
  retryable: boolean;
}

/**
 * The error `ɵtranscribeAudio` throws. Read `error.info.code` to pick a
 * message for the user, or pass `error.info` to
 * `ɵtranscriptionErrorMessageKey`.
 */
export class TranscriptionError extends Error {
  readonly info: TranscriptionErrorInfo;

  constructor(info: TranscriptionErrorInfo) {
    super(info.message);
    this.name = "TranscriptionError";
    this.info = info;
  }
}

/** The parts of `CopilotKitCore` that a transcription request reads. */
export type TranscriptionCore = Pick<
  CopilotKitCore,
  "runtimeUrl" | "runtimeTransport" | "resolveHeaders" | "credentials"
>;

/**
 * Send a recording to the CopilotKit runtime and get its text back.
 *
 * The request follows the transport set on the core:
 * - `"single"`: one JSON POST to `runtimeUrl`, with the audio as base64.
 * - any other transport: a multipart POST to `${runtimeUrl}/transcribe`.
 *
 * Headers are resolved on each call. The core's `credentials` are sent when
 * they are set, the same as for agent requests.
 *
 * @param core - The `CopilotKitCore` (or a framework subclass) to send through.
 * @param audioBlob - The recorded audio.
 * @param filename - The file name the runtime sees. Defaults to `"recording.webm"`.
 * @returns The transcription result, with the text in `result.text`.
 * @throws {TranscriptionError} When the runtime URL is not set, the request
 * fails, or the runtime returns an error. `error.info` has the code.
 *
 * @example
 * ```ts
 * try {
 *   const { text } = await ɵtranscribeAudio(core, blob);
 * } catch (error) {
 *   if (error instanceof TranscriptionError) {
 *     const key = ɵtranscriptionErrorMessageKey(error.info);
 *     showError(key ? labels[key] : error.info.message);
 *   }
 * }
 * ```
 */
export async function ɵtranscribeAudio(
  core: TranscriptionCore,
  audioBlob: Blob,
  filename = "recording.webm",
) {
  const { runtimeUrl, credentials } = core;
  if (!runtimeUrl) {
    throw new TranscriptionError({
      code: TranscriptionErrorCode.INVALID_REQUEST,
      message: "Runtime URL is not configured",
      retryable: false,
    });
  }

  // Resolve once, up front, OUTSIDE the try below. Never through
  // `ɵruntimeFetch` (this request is built by hand, not sent via an agent),
  // and never a stale snapshot: a key that no longer resolves must not ride
  // along (#1937). A builder failure here must surface as itself, not get
  // caught and re-wrapped as a NETWORK_ERROR `TranscriptionError`.
  const resolvedHeaders = await core.resolveHeaders();
  const credentialsInit = credentials ? { credentials } : {};

  let response: Response;
  try {
    response =
      core.runtimeTransport === "single"
        ? await fetch(runtimeUrl, {
            method: "POST",
            headers: {
              ...omitContentType(resolvedHeaders),
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              method: "transcribe",
              body: {
                audio: await blobToBase64(audioBlob),
                mimeType: audioBlob.type || "audio/webm",
                filename,
              },
            }),
            ...credentialsInit,
          })
        : await fetch(`${runtimeUrl}/transcribe`, {
            method: "POST",
            // No Content-Type: fetch sets it, with the boundary, for FormData.
            headers: omitContentType(resolvedHeaders),
            body: toFormData(audioBlob, filename),
            ...credentialsInit,
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

/**
 * Pick the chat label to show the user for a transcription error.
 *
 * @param error - The `info` of a `TranscriptionError`.
 * @returns A key of the chat labels, or `null`. `null` means no label fits:
 * show `error.message` instead.
 *
 * @example
 * ```ts
 * const key = ɵtranscriptionErrorMessageKey(error.info);
 * const text = key ? labels[key] : error.info.message;
 * ```
 */
export function ɵtranscriptionErrorMessageKey(error: TranscriptionErrorInfo) {
  switch (error.code) {
    case TranscriptionErrorCode.RATE_LIMITED:
      return "transcriptionErrorRateLimitedText";
    case TranscriptionErrorCode.AUTH_FAILED:
      return "transcriptionErrorAuthFailedText";
    case TranscriptionErrorCode.AUDIO_TOO_LONG:
      return "transcriptionErrorAudioTooLongText";
    case TranscriptionErrorCode.AUDIO_TOO_SHORT:
      return "transcriptionErrorAudioTooShortText";
    case TranscriptionErrorCode.INVALID_AUDIO_FORMAT:
      return "transcriptionErrorInvalidAudioFormatText";
    case TranscriptionErrorCode.SERVICE_NOT_CONFIGURED:
      return "transcriptionErrorServiceNotConfiguredText";
    case TranscriptionErrorCode.NETWORK_ERROR:
      return "transcriptionErrorNetworkText";
    default:
      return error.retryable ? "transcriptionErrorGenericText" : null;
  }
}

/** The chat label keys that `ɵtranscriptionErrorMessageKey` can return. */
export type ɵTranscriptionErrorLabelKey = NonNullable<
  ReturnType<typeof ɵtranscriptionErrorMessageKey>
>;

function toFormData(audioBlob: Blob, filename: string) {
  const formData = new FormData();
  formData.append("audio", audioBlob, filename);
  return formData;
}

function omitContentType(headers: Readonly<Record<string, string>>) {
  const entries = Object.entries(headers);
  return Object.fromEntries(
    entries.filter(([name]) => name.toLowerCase() !== "content-type"),
  );
}

async function blobToBase64(blob: Blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  // Build the binary string in chunks: one spread of a large array overflows
  // the call stack.
  const chunkSize = 0x8000;
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(
      ...bytes.subarray(offset, offset + chunkSize),
    );
  }
  return btoa(binary);
}

/** Build a typed error from a non-OK transcription response. */
async function toTranscriptionError(response: Response) {
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
      ? String(data.message)
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
    "error" in data &&
    "message" in data &&
    typeof data.error === "string" &&
    typeof data.message === "string"
  );
}
