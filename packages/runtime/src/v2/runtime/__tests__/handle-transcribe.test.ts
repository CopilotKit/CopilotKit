import { handleTranscribe } from "../handlers/handle-transcribe";
import { CopilotRuntime } from "../runtime";
import {
  TranscriptionService,
  TranscribeFileOptions,
} from "../transcription-service/transcription-service";
import { describe, it, expect } from "vitest";

// Mock TranscriptionService
class MockTranscriptionService extends TranscriptionService {
  public lastOptions?: TranscribeFileOptions;

  constructor(
    private shouldThrow = false,
    private returnText = "Mock transcription",
  ) {
    super();
  }

  async transcribeFile(options: TranscribeFileOptions): Promise<string> {
    this.lastOptions = options;
    if (this.shouldThrow) {
      throw new Error("Transcription service error");
    }
    return this.returnText;
  }
}

describe("handleTranscribe", () => {
  const createMockRuntime = (
    transcriptionService?: TranscriptionService,
  ): CopilotRuntime => {
    return {
      agents: Promise.resolve({}),
      transcriptionService,
      beforeRequestMiddleware: undefined,
      afterRequestMiddleware: undefined,
    } as CopilotRuntime;
  };

  const createMockAudioFile = (
    name = "test.mp3",
    type = "audio/mpeg",
    size = 1024,
  ): File => {
    const content = new Uint8Array(size);
    return new File([content], name, { type });
  };

  const createFormDataRequest = (audioFile?: File): Request => {
    const formData = new FormData();
    if (audioFile) {
      formData.append("audio", audioFile);
    }

    return new Request("https://example.com/transcribe", {
      method: "POST",
      body: formData,
    });
  };

  const createJsonRequest = (): Request => {
    return new Request("https://example.com/transcribe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ test: "data" }),
    });
  };

  it("should successfully transcribe an audio file", async () => {
    const mockService = new MockTranscriptionService(false, "Hello world");
    const runtime = createMockRuntime(mockService);
    const audioFile = createMockAudioFile("test.mp3", "audio/mpeg", 2048);
    const request = createFormDataRequest(audioFile);

    const response = await handleTranscribe({ runtime, request });

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("application/json");

    const body = await response.json();
    expect(body).toEqual({
      text: "Hello world",
      size: 2048,
      type: "audio/mpeg",
    });
  });

  it("should return 503 when transcription service is not configured", async () => {
    const runtime = createMockRuntime(); // No transcription service
    const audioFile = createMockAudioFile();
    const request = createFormDataRequest(audioFile);

    const response = await handleTranscribe({ runtime, request });

    expect(response.status).toBe(503);
    expect(response.headers.get("Content-Type")).toBe("application/json");

    const body = await response.json();
    expect(body).toEqual({
      error: "service_not_configured",
      message: "Transcription service is not configured",
      retryable: false,
    });
  });

  it("should return 400 when request is not form data", async () => {
    const mockService = new MockTranscriptionService();
    const runtime = createMockRuntime(mockService);
    const request = createJsonRequest();

    const response = await handleTranscribe({ runtime, request });

    expect(response.status).toBe(400);
    expect(response.headers.get("Content-Type")).toBe("application/json");

    const body = await response.json();
    expect(body).toEqual({
      error: "invalid_request",
      message:
        "Request must include 'audio' field with base64-encoded audio data",
      retryable: false,
    });
  });

  it("should return 400 when no audio file is provided", async () => {
    const mockService = new MockTranscriptionService();
    const runtime = createMockRuntime(mockService);
    const request = createFormDataRequest(); // No audio file

    const response = await handleTranscribe({ runtime, request });

    expect(response.status).toBe(400);
    expect(response.headers.get("Content-Type")).toBe("application/json");

    const body = await response.json();
    expect(body).toEqual({
      error: "invalid_request",
      message:
        "No audio file found in form data. Please include an 'audio' field.",
      retryable: false,
    });
  });

  it("should accept various valid audio file types", async () => {
    const mockService = new MockTranscriptionService();
    const runtime = createMockRuntime(mockService);

    const validTypes = [
      "audio/mpeg",
      "audio/mp3",
      "audio/mp4",
      "audio/wav",
      "audio/webm",
      "audio/ogg",
      "audio/flac",
      "audio/aac",
    ];

    for (const type of validTypes) {
      const audioFile = createMockAudioFile(`test.${type.split("/")[1]}`, type);
      const request = createFormDataRequest(audioFile);

      const response = await handleTranscribe({ runtime, request });
      expect(response.status).toBe(200);
    }
  });

  it("should accept files with empty type (some browsers/systems)", async () => {
    const mockService = new MockTranscriptionService();
    const runtime = createMockRuntime(mockService);
    const audioFile = createMockAudioFile("test.mp3", ""); // Empty type
    const request = createFormDataRequest(audioFile);

    const response = await handleTranscribe({ runtime, request });

    expect(response.status).toBe(200);
  });

  it("should accept files with application/octet-stream type (fallback)", async () => {
    const mockService = new MockTranscriptionService();
    const runtime = createMockRuntime(mockService);
    const audioFile = createMockAudioFile(
      "test.mp3",
      "application/octet-stream",
    );
    const request = createFormDataRequest(audioFile);

    const response = await handleTranscribe({ runtime, request });

    expect(response.status).toBe(200);
  });

  it("should return 400 for invalid file types", async () => {
    const mockService = new MockTranscriptionService();
    const runtime = createMockRuntime(mockService);
    const audioFile = createMockAudioFile("test.txt", "text/plain");
    const request = createFormDataRequest(audioFile);

    const response = await handleTranscribe({ runtime, request });

    expect(response.status).toBe(400);
    expect(response.headers.get("Content-Type")).toBe("application/json");

    const body = await response.json();
    expect(body.error).toBe("invalid_audio_format");
    expect(body.message).toContain("Unsupported audio format: text/plain");
    expect(body.retryable).toBe(false);
  });

  it("should return 500 when transcription service throws an error", async () => {
    const mockService = new MockTranscriptionService(true); // Will throw error
    const runtime = createMockRuntime(mockService);
    const audioFile = createMockAudioFile();
    const request = createFormDataRequest(audioFile);

    const response = await handleTranscribe({ runtime, request });

    expect(response.status).toBe(500);
    expect(response.headers.get("Content-Type")).toBe("application/json");

    const body = await response.json();
    expect(body).toEqual({
      error: "provider_error",
      message: "Transcription service error",
      retryable: true,
    });
  });

  it("should handle form data parsing errors gracefully", async () => {
    const mockService = new MockTranscriptionService();
    const runtime = createMockRuntime(mockService);

    // Create a request with malformed form data
    const request = new Request("https://example.com/transcribe", {
      method: "POST",
      headers: { "Content-Type": "multipart/form-data; boundary=invalid" },
      body: "invalid form data",
    });

    const response = await handleTranscribe({ runtime, request });

    expect(response.status).toBe(500);
    expect(response.headers.get("Content-Type")).toBe("application/json");

    const body = await response.json();
    expect(body.error).toBe("provider_error");
    expect(body.retryable).toBe(true);
  });

  it("should handle non-File objects in form data", async () => {
    const mockService = new MockTranscriptionService();
    const runtime = createMockRuntime(mockService);

    const formData = new FormData();
    formData.append("audio", "not a file"); // String instead of File

    const request = new Request("https://example.com/transcribe", {
      method: "POST",
      body: formData,
    });

    const response = await handleTranscribe({ runtime, request });

    expect(response.status).toBe(400);
    expect(response.headers.get("Content-Type")).toBe("application/json");

    const body = await response.json();
    expect(body).toEqual({
      error: "invalid_request",
      message:
        "No audio file found in form data. Please include an 'audio' field.",
      retryable: false,
    });
  });

  it("should pass file metadata to transcription service", async () => {
    const mockService = new MockTranscriptionService();
    const runtime = createMockRuntime(mockService);
    const audioFile = createMockAudioFile(
      "my-recording.wav",
      "audio/wav",
      2048,
    );

    const request = createFormDataRequest(audioFile);

    const response = await handleTranscribe({ runtime, request });

    expect(response.status).toBe(200);
    expect(mockService.lastOptions).toEqual({
      audioFile: expect.objectContaining({
        name: "my-recording.wav",
        type: "audio/wav",
        size: 2048,
      }),
      mimeType: "audio/wav",
      size: 2048,
    });
  });
});
