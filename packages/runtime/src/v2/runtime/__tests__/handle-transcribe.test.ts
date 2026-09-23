import { handleTranscribe } from "../handlers/handle-transcribe";
import type { CopilotRuntime } from "../core/runtime";
import type { TranscribeFileOptions } from "../transcription-service/transcription-service";
import { TranscriptionService } from "../transcription-service/transcription-service";
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
    } as unknown as CopilotRuntime;
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

  const createJsonRequest = (
    body: Record<string, unknown> = { test: "data" },
  ): Request => {
    return new Request("https://example.com/transcribe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  };

  const audioTooShortBody = {
    error: "audio_too_short",
    message: "Audio is too short to transcribe",
    retryable: false,
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

  describe("empty audio", () => {
    it("should return 400 audio_too_short for a 0-byte multipart upload without calling the service", async () => {
      const mockService = new MockTranscriptionService();
      const runtime = createMockRuntime(mockService);
      const audioFile = createMockAudioFile("empty.webm", "audio/webm", 0);
      const request = createFormDataRequest(audioFile);

      const response = await handleTranscribe({ runtime, request });

      expect(response.status).toBe(400);
      expect(response.headers.get("Content-Type")).toBe("application/json");
      expect(await response.json()).toEqual(audioTooShortBody);
      expect(mockService.lastOptions).toBeUndefined();
    });

    it("should return 400 audio_too_short for a 0-byte multipart upload with no MIME type", async () => {
      const mockService = new MockTranscriptionService();
      const runtime = createMockRuntime(mockService);
      const audioFile = createMockAudioFile("recording.webm", "", 0);
      const request = createFormDataRequest(audioFile);

      const response = await handleTranscribe({ runtime, request });

      expect(response.status).toBe(400);
      expect(await response.json()).toEqual(audioTooShortBody);
      expect(mockService.lastOptions).toBeUndefined();
    });

    it("should return 400 audio_too_short for empty base64 audio (what clients send for an empty Blob)", async () => {
      const mockService = new MockTranscriptionService();
      const runtime = createMockRuntime(mockService);
      const request = createJsonRequest({ audio: "", mimeType: "audio/webm" });

      const response = await handleTranscribe({ runtime, request });

      expect(response.status).toBe(400);
      expect(await response.json()).toEqual(audioTooShortBody);
      expect(mockService.lastOptions).toBeUndefined();
    });

    it("should return 400 audio_too_short for a data URL with an empty base64 payload", async () => {
      const mockService = new MockTranscriptionService();
      const runtime = createMockRuntime(mockService);
      const request = createJsonRequest({
        audio: "data:audio/webm;base64,",
        mimeType: "audio/webm",
      });

      const response = await handleTranscribe({ runtime, request });

      expect(response.status).toBe(400);
      expect(await response.json()).toEqual(audioTooShortBody);
      expect(mockService.lastOptions).toBeUndefined();
    });

    it("should still return 400 invalid_request when the base64 audio field is missing", async () => {
      const mockService = new MockTranscriptionService();
      const runtime = createMockRuntime(mockService);
      const request = createJsonRequest({ mimeType: "audio/webm" });

      const response = await handleTranscribe({ runtime, request });

      expect(response.status).toBe(400);
      expect((await response.json()).error).toBe("invalid_request");
      expect(mockService.lastOptions).toBeUndefined();
    });

    it("should pass a 1-byte multipart upload through to the service", async () => {
      const mockService = new MockTranscriptionService(false, "ok");
      const runtime = createMockRuntime(mockService);
      const audioFile = createMockAudioFile("tiny.webm", "audio/webm", 1);
      const request = createFormDataRequest(audioFile);

      const response = await handleTranscribe({ runtime, request });

      expect(response.status).toBe(200);
      expect(mockService.lastOptions).toEqual({
        audioFile: expect.objectContaining({ size: 1, type: "audio/webm" }),
        mimeType: "audio/webm",
        size: 1,
      });
    });

    it("should pass non-empty base64 audio through to the service", async () => {
      const mockService = new MockTranscriptionService(false, "ok");
      const runtime = createMockRuntime(mockService);
      // "AAEC" decodes to the 3 bytes [0x00, 0x01, 0x02]
      const request = createJsonRequest({
        audio: "data:audio/webm;base64,AAEC",
        mimeType: "audio/webm",
        filename: "clip.webm",
      });

      const response = await handleTranscribe({ runtime, request });

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        text: "ok",
        size: 3,
        type: "audio/webm",
      });
      expect(mockService.lastOptions).toEqual({
        audioFile: expect.objectContaining({
          name: "clip.webm",
          size: 3,
          type: "audio/webm",
        }),
        mimeType: "audio/webm",
        size: 3,
      });
    });
  });
});
