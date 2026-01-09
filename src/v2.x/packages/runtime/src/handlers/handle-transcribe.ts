import { CopilotRuntime } from "../runtime";

interface HandleTranscribeParameters {
  runtime: CopilotRuntime;
  request: Request;
}

interface Base64AudioInput {
  audio: string; // base64-encoded audio data
  mimeType: string;
  filename?: string;
}

const validAudioTypes = [
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
    validAudioTypes.includes(baseType) ||
    baseType === "" ||
    baseType === "application/octet-stream"
  );
}

function base64ToFile(base64: string, mimeType: string, filename: string): File {
  // Remove data URL prefix if present (e.g., "data:audio/webm;base64,")
  const base64Data = base64.includes(",") ? base64.split(",")[1] ?? base64 : base64;

  // Decode base64 to binary
  const binaryString = atob(base64Data);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }

  // Create File object
  return new File([bytes], filename, { type: mimeType });
}

async function extractAudioFromFormData(request: Request): Promise<{ file: File } | { error: Response }> {
  const formData = await request.formData();
  const audioFile = formData.get("audio") as File | null;

  if (!audioFile || !(audioFile instanceof File)) {
    return {
      error: new Response(
        JSON.stringify({
          error: "Missing audio file",
          message: "No audio file found in form data. Please include an 'audio' field.",
        }),
        {
          status: 400,
          headers: { "Content-Type": "application/json" },
        }
      ),
    };
  }

  if (!isValidAudioType(audioFile.type)) {
    return {
      error: new Response(
        JSON.stringify({
          error: "Invalid file type",
          message: `Unsupported audio file type: ${audioFile.type}. Supported types: ${validAudioTypes.join(", ")}, or files with unknown/empty types`,
        }),
        {
          status: 400,
          headers: { "Content-Type": "application/json" },
        }
      ),
    };
  }

  return { file: audioFile };
}

async function extractAudioFromJson(request: Request): Promise<{ file: File } | { error: Response }> {
  let body: Base64AudioInput;

  try {
    body = await request.json();
  } catch {
    return {
      error: new Response(
        JSON.stringify({
          error: "Invalid JSON",
          message: "Request body must be valid JSON",
        }),
        {
          status: 400,
          headers: { "Content-Type": "application/json" },
        }
      ),
    };
  }

  if (!body.audio || typeof body.audio !== "string") {
    return {
      error: new Response(
        JSON.stringify({
          error: "Missing audio data",
          message: "Request must include 'audio' field with base64-encoded audio data",
        }),
        {
          status: 400,
          headers: { "Content-Type": "application/json" },
        }
      ),
    };
  }

  if (!body.mimeType || typeof body.mimeType !== "string") {
    return {
      error: new Response(
        JSON.stringify({
          error: "Missing mimeType",
          message: "Request must include 'mimeType' field (e.g., 'audio/webm')",
        }),
        {
          status: 400,
          headers: { "Content-Type": "application/json" },
        }
      ),
    };
  }

  if (!isValidAudioType(body.mimeType)) {
    return {
      error: new Response(
        JSON.stringify({
          error: "Invalid file type",
          message: `Unsupported audio file type: ${body.mimeType}. Supported types: ${validAudioTypes.join(", ")}`,
        }),
        {
          status: 400,
          headers: { "Content-Type": "application/json" },
        }
      ),
    };
  }

  try {
    const filename = body.filename || "recording.webm";
    const file = base64ToFile(body.audio, body.mimeType, filename);
    return { file };
  } catch {
    return {
      error: new Response(
        JSON.stringify({
          error: "Invalid base64 data",
          message: "Failed to decode base64 audio data",
        }),
        {
          status: 400,
          headers: { "Content-Type": "application/json" },
        }
      ),
    };
  }
}

export async function handleTranscribe({
  runtime,
  request,
}: HandleTranscribeParameters) {
  try {
    // Check if transcription service is configured
    if (!runtime.transcriptionService) {
      return new Response(
        JSON.stringify({
          error: "Transcription service not configured",
          message: "No transcription service has been configured in the runtime",
        }),
        {
          status: 503,
          headers: { "Content-Type": "application/json" },
        }
      );
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
      return new Response(
        JSON.stringify({
          error: "Invalid content type",
          message: "Request must be multipart/form-data or application/json with base64 audio",
        }),
        {
          status: 400,
          headers: { "Content-Type": "application/json" },
        }
      );
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
      }
    );
  } catch (error) {
    return new Response(
      JSON.stringify({
        error: "Transcription failed",
        message:
          error instanceof Error
            ? error.message
            : "Unknown error occurred during transcription",
      }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      }
    );
  }
}
