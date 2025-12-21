import { CopilotRuntime } from "../runtime";

interface HandleTranscribeParameters {
  runtime: CopilotRuntime;
  request: Request;
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
          message:
            "No transcription service has been configured in the runtime",
        }),
        {
          status: 503,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    // Check if request has form data
    const contentType = request.headers.get("content-type");
    if (!contentType || !contentType.includes("multipart/form-data")) {
      return new Response(
        JSON.stringify({
          error: "Invalid content type",
          message:
            "Request must contain multipart/form-data with an audio file",
        }),
        {
          status: 400,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    // Extract form data
    const formData = await request.formData();
    const audioFile = formData.get("audio") as File | null;

    if (!audioFile || !(audioFile instanceof File)) {
      return new Response(
        JSON.stringify({
          error: "Missing audio file",
          message:
            "No audio file found in form data. Please include an 'audio' field.",
        }),
        {
          status: 400,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    // Validate file type (basic check)
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

    // Allow empty types and application/octet-stream (common fallback for unknown types)
    const isValidType =
      validAudioTypes.includes(audioFile.type) ||
      audioFile.type === "" ||
      audioFile.type === "application/octet-stream";

    if (!isValidType) {
      return new Response(
        JSON.stringify({
          error: "Invalid file type",
          message: `Unsupported audio file type: ${audioFile.type}. Supported types: ${validAudioTypes.join(", ")}, or files with unknown/empty types`,
        }),
        {
          status: 400,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    // Transcribe the audio file with options
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
