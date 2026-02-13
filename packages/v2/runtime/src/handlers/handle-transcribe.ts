import { CopilotRuntime } from "../runtime";
import {
  TranscriptionErrorCode,
  TranscriptionErrors,
  type TranscriptionErrorResponse,
} from "@copilotkitnext/shared";

/**
 * HTTP status codes for transcription error codes
 */
const ERROR_STATUS_CODES: Record<TranscriptionErrorCode, number> = {
  [TranscriptionErrorCode.SERVICE_NOT_CONFIGURED]: 503,
  [TranscriptionErrorCode.INVALID_AUDIO_FORMAT]: 400,
  [TranscriptionErrorCode.AUDIO_TOO_LONG]: 400,
  [TranscriptionErrorCode.AUDIO_TOO_SHORT]: 400,
  [TranscriptionErrorCode.RATE_LIMITED]: 429,
  [TranscriptionErrorCode.AUTH_FAILED]: 401,
  [TranscriptionErrorCode.PROVIDER_ERROR]: 500,
  [TranscriptionErrorCode.NETWORK_ERROR]: 502,
  [TranscriptionErrorCode.INVALID_REQUEST]: 400,
};

interface HandleTranscribeParameters {
  runtime: CopilotRuntime;
  request: Request;
}

interface Base64AudioInput {
  audio: string; // base64-encoded audio data
  mimeType: string;
  filename?: string;
}

const VALID_AUDIO_TYPES = [
  "audio/mpeg",
  "audio/mp3",
  "audio/mp4",
  "audio/wav",
  "audio/webm",
  "audio/ogg",
  "audio/flac",
  "audio/aac",
];

function isValidAudioType(type: string): boolean {
  // Extract base MIME type (before semicolon) to handle types like "audio/webm; codecs=opus"
  const baseType = type.split(";")[0]?.trim() ?? "";
  return (
    VALID_AUDIO_TYPES.includes(baseType) ||
    baseType === "" ||
    baseType === "application/octet-stream"
  );
}

function createErrorResponse(
  errorResponse: TranscriptionErrorResponse,
): Response {
  const status = ERROR_STATUS_CODES[errorResponse.error] ?? 500;
  return new Response(JSON.stringify(errorResponse), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function base64ToFile(
  base64: string,
  mimeType: string,
  filename: string,
): File {
  // Remove data URL prefix if present (e.g., "data:audio/webm;base64,")
  const base64Data = base64.includes(",")
    ? (base64.split(",")[1] ?? base64)
    : base64;

  // Decode base64 to binary
  const binaryString = atob(base64Data);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }

  // Create File object
  return new File([bytes], filename, { type: mimeType });
}

async function extractAudioFromFormData(
  request: Request,
): Promise<{ file: File } | { error: Response }> {
  const formData = await request.formData();
  const audioFile = formData.get("audio") as File | null;

  if (!audioFile || !(audioFile instanceof File)) {
    const err = TranscriptionErrors.invalidRequest(
      "No audio file found in form data. Please include an 'audio' field.",
    );
    return { error: createErrorResponse(err) };
  }

  if (!isValidAudioType(audioFile.type)) {
    const err = TranscriptionErrors.invalidAudioFormat(
      audioFile.type,
      VALID_AUDIO_TYPES,
    );
    return { error: createErrorResponse(err) };
  }

  return { file: audioFile };
}

async function extractAudioFromJson(
  request: Request,
): Promise<{ file: File } | { error: Response }> {
  let body: Base64AudioInput;

  try {
    body = await request.json();
  } catch {
    const err = TranscriptionErrors.invalidRequest(
      "Request body must be valid JSON",
    );
    return { error: createErrorResponse(err) };
  }

  if (!body.audio || typeof body.audio !== "string") {
    const err = TranscriptionErrors.invalidRequest(
      "Request must include 'audio' field with base64-encoded audio data",
    );
    return { error: createErrorResponse(err) };
  }

  if (!body.mimeType || typeof body.mimeType !== "string") {
    const err = TranscriptionErrors.invalidRequest(
      "Request must include 'mimeType' field (e.g., 'audio/webm')",
    );
    return { error: createErrorResponse(err) };
  }

  if (!isValidAudioType(body.mimeType)) {
    const err = TranscriptionErrors.invalidAudioFormat(
      body.mimeType,
      VALID_AUDIO_TYPES,
    );
    return { error: createErrorResponse(err) };
  }

  try {
    const filename = body.filename || "recording.webm";
    const file = base64ToFile(body.audio, body.mimeType, filename);
    return { file };
  } catch {
    const err = TranscriptionErrors.invalidRequest(
      "Failed to decode base64 audio data",
    );
    return { error: createErrorResponse(err) };
  }
}

/**
 * Categorize provider errors into appropriate transcription error responses.
 */
function categorizeProviderError(error: unknown): TranscriptionErrorResponse {
  const message =
    error instanceof Error ? error.message : "Unknown error occurred";
  const errorStr = String(error).toLowerCase();

  // Check for rate limiting
  if (
    errorStr.includes("rate") ||
    errorStr.includes("429") ||
    errorStr.includes("too many")
  ) {
    return TranscriptionErrors.rateLimited();
  }

  // Check for auth errors
  if (
    errorStr.includes("auth") ||
    errorStr.includes("401") ||
    errorStr.includes("api key") ||
    errorStr.includes("unauthorized")
  ) {
    return TranscriptionErrors.authFailed();
  }

  // Check for audio too long
  if (
    errorStr.includes("too long") ||
    errorStr.includes("duration") ||
    errorStr.includes("length")
  ) {
    return TranscriptionErrors.audioTooLong();
  }

  // Default to provider error
  return TranscriptionErrors.providerError(message);
}

export async function handleTranscribe({
  runtime,
  request,
}: HandleTranscribeParameters) {
  try {
    // Check if transcription service is configured
    if (!runtime.transcriptionService) {
      const err = TranscriptionErrors.serviceNotConfigured();
      return createErrorResponse(err);
    }

    // Determine input type based on content-type header
    const contentType = request.headers.get("content-type") || "";

    let extractResult: { file: File } | { error: Response };

    if (contentType.includes("multipart/form-data")) {
      // Handle multipart/form-data (REST mode)
      extractResult = await extractAudioFromFormData(request);
    } else if (contentType.includes("application/json")) {
      // Handle JSON with base64 audio (single-endpoint mode)
      extractResult = await extractAudioFromJson(request);
    } else {
      const err = TranscriptionErrors.invalidRequest(
        "Request must be multipart/form-data or application/json with base64 audio",
      );
      return createErrorResponse(err);
    }

    // Check for extraction errors
    if ("error" in extractResult) {
      return extractResult.error;
    }

    const audioFile = extractResult.file;

    // Transcribe the audio file
    const transcription = await runtime.transcriptionService.transcribeFile({
      audioFile,
      mimeType: audioFile.type,
      size: audioFile.size,
    });

    return new Response(
      JSON.stringify({
        text: transcription,
        size: audioFile.size,
        type: audioFile.type,
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      },
    );
  } catch (error) {
    // Categorize the error for better client-side handling
    return createErrorResponse(categorizeProviderError(error));
  }
}
