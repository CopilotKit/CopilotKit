import { beforeEach, describe, expect, it, vi } from "vitest";

const { openAI, transcriptionService } = vi.hoisted(() => ({
  openAI: vi.fn(function OpenAI() {}),
  transcriptionService: vi.fn(function TranscriptionServiceOpenAI() {}),
}));

vi.mock("openai", () => ({ OpenAI: openAI }));
vi.mock("@copilotkit/voice", () => ({
  TranscriptionServiceOpenAI: transcriptionService,
}));

import { createTranscriptionService } from "./transcription-service";

describe("createTranscriptionService", () => {
  beforeEach(() => vi.clearAllMocks());

  it("does not advertise transcription from the chat provider credentials", () => {
    expect(
      createTranscriptionService({
        OPENAI_API_KEY: "aimock-placeholder",
        OPENAI_BASE_URL: "http://aimock:4010/v1",
      }),
    ).toBeUndefined();
    expect(openAI).not.toHaveBeenCalled();
  });

  it("uses only the dedicated transcription endpoint and credential", () => {
    createTranscriptionService({
      OPENAI_API_KEY: "aimock-placeholder",
      OPENAI_BASE_URL: "http://aimock:4010/v1",
      OPENAI_TRANSCRIPTION_API_KEY: "transcription-key",
      OPENAI_TRANSCRIPTION_BASE_URL: "https://speech.example.com/v1",
    });

    expect(openAI).toHaveBeenCalledWith({
      apiKey: "transcription-key",
      baseURL: "https://speech.example.com/v1",
    });
    expect(transcriptionService).toHaveBeenCalledOnce();
  });

  it("defaults dedicated transcription to the real OpenAI endpoint", () => {
    createTranscriptionService({
      OPENAI_TRANSCRIPTION_API_KEY: "transcription-key",
      OPENAI_BASE_URL: "http://aimock:4010/v1",
    });

    expect(openAI).toHaveBeenCalledWith({
      apiKey: "transcription-key",
      baseURL: "https://api.openai.com/v1",
    });
  });
});
