import { afterEach, describe, expect, it, vi } from "vitest";
import { TranscriptionErrorCode } from "@copilotkitnext/shared";
import { transcribeAudio, TranscriptionError } from "../transcription-client";
import type { CopilotKitCoreVue } from "../vue-core";

describe("transcription-client", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("transcribes audio in REST mode", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ text: "Transcribed text", size: 12, type: "audio/webm" }),
    } satisfies Partial<Response>) as typeof fetch;

    const result = await transcribeAudio(
      {
        runtimeUrl: "/api/copilotkit",
        runtimeTransport: "rest",
        headers: {},
      } as CopilotKitCoreVue,
      new Blob(["audio"], { type: "audio/webm" }),
    );

    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    expect(result.text).toBe("Transcribed text");
  });

  it("maps structured error responses to TranscriptionError", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 429,
      statusText: "Too Many Requests",
      json: async () => ({
        error: TranscriptionErrorCode.RATE_LIMITED,
        message: "Rate limited",
        retryable: true,
      }),
    } satisfies Partial<Response>) as typeof fetch;

    await expect(
      transcribeAudio(
        {
          runtimeUrl: "/api/copilotkit",
          runtimeTransport: "rest",
          headers: {},
        } as CopilotKitCoreVue,
        new Blob(["audio"], { type: "audio/webm" }),
      ),
    ).rejects.toMatchObject({
      info: {
        code: TranscriptionErrorCode.RATE_LIMITED,
        retryable: true,
      },
    } satisfies Partial<TranscriptionError>);
  });
});
