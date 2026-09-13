import { describe, expect, it } from "vitest";
import { resolveTranscriptionBaseUrl } from "./transcription-base-url";

describe("resolveTranscriptionBaseUrl", () => {
  it("keeps an explicit transcription endpoint authoritative", () => {
    expect(
      resolveTranscriptionBaseUrl({
        OPENAI_TRANSCRIPTION_BASE_URL: "https://transcription.example/v1",
        AIMOCK_URL: "http://127.0.0.1:4410",
      }),
    ).toBe("https://transcription.example/v1");
  });

  it("uses the local AIMock OpenAI API only when it is configured", () => {
    expect(
      resolveTranscriptionBaseUrl({ AIMOCK_URL: "http://127.0.0.1:4410/" }),
    ).toBe("http://127.0.0.1:4410/v1");
    expect(
      resolveTranscriptionBaseUrl({ AIMOCK_URL: "http://127.0.0.1:4410/v1" }),
    ).toBe("http://127.0.0.1:4410/v1");
  });

  it("retains the production OpenAI endpoint without local configuration", () => {
    expect(resolveTranscriptionBaseUrl({})).toBe("https://api.openai.com/v1");
  });
});
