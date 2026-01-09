import type { CopilotKitCoreReact } from "./react-core";

export interface TranscriptionResult {
  text: string;
  size: number;
  type: string;
}

export interface TranscriptionError {
  error: string;
  message: string;
}

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
      resolve(base64);
    };
    reader.onerror = () => reject(new Error("Failed to convert blob to base64"));
    reader.readAsDataURL(blob);
  });
}

/**
 * Transcribe an audio blob using the CopilotKit runtime
 *
 * Supports both REST mode (multipart/form-data) and single-endpoint mode (base64 JSON)
 */
export async function transcribeAudio(
  core: CopilotKitCoreReact,
  audioBlob: Blob,
  filename: string = "recording.webm"
): Promise<TranscriptionResult> {
  const runtimeUrl = core.runtimeUrl;
  if (!runtimeUrl) {
    throw new Error("Runtime URL is not configured");
  }

  const headers: Record<string, string> = { ...core.headers };
  let response: Response;

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

  if (!response.ok) {
    let errorData: TranscriptionError;
    try {
      errorData = await response.json();
    } catch {
      errorData = {
        error: "Request failed",
        message: `HTTP ${response.status}: ${response.statusText}`,
      };
    }
    throw new Error(errorData.message || errorData.error || "Transcription failed");
  }

  return (await response.json()) as TranscriptionResult;
}
