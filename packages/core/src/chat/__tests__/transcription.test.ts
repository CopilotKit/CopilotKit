import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TranscriptionErrorCode } from "@copilotkit/shared";
import {
  TranscriptionError,
  ɵtranscribeAudio,
  ɵtranscriptionErrorMessageKey,
} from "../transcription";
import type {
  TranscriptionCore,
  TranscriptionErrorInfo,
} from "../transcription";

const RUNTIME_URL = "https://runtime.example/api/copilotkit";
const TRANSCRIBED = { text: "Hello there", size: 5, type: "audio/webm" };

const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function createCore(overrides?: Partial<TranscriptionCore>): TranscriptionCore {
  return {
    runtimeUrl: RUNTIME_URL,
    runtimeTransport: "rest",
    credentials: undefined,
    resolveHeaders: () => ({}),
    ...overrides,
  };
}

function createAudio(type = "audio/webm") {
  return new Blob(["audio"], { type });
}

function respondWith(body: string, init: ResponseInit) {
  fetchMock.mockImplementation(async () => new Response(body, init));
}

function respondJson(body: object, status = 200) {
  respondWith(JSON.stringify(body), { status });
}

function sentRequest(index = 0) {
  const [input, init] = fetchMock.mock.calls[index] ?? [];
  return {
    url: String(input),
    init,
    headers: Object.fromEntries(new Headers(init?.headers)),
  };
}

async function transcriptionFailure(core = createCore()) {
  try {
    await ɵtranscribeAudio(core, createAudio());
  } catch (error) {
    if (error instanceof TranscriptionError) return error.info;
    throw error;
  }
  throw new Error("Expected ɵtranscribeAudio to throw");
}

describe("ɵtranscribeAudio", () => {
  it("posts the audio as multipart form data to /transcribe in REST mode", async () => {
    respondJson(TRANSCRIBED);

    const result = await ɵtranscribeAudio(
      createCore(),
      createAudio(),
      "a.webm",
    );

    expect(result).toEqual(TRANSCRIBED);
    const { url, init } = sentRequest();
    expect(url).toBe(`${RUNTIME_URL}/transcribe`);
    expect(init?.method).toBe("POST");
    const body = init?.body;
    if (!(body instanceof FormData)) throw new Error("Expected FormData body");
    const audio = body.get("audio");
    if (!(audio instanceof File)) throw new Error("Expected an audio file");
    expect(audio.name).toBe("a.webm");
    expect(await audio.text()).toBe("audio");
  });

  it("drops any Content-Type header, in any case, in REST mode", async () => {
    respondJson(TRANSCRIBED);
    const core = createCore({
      resolveHeaders: () => ({
        "content-type": "text/plain",
        Authorization: "Bearer token",
      }),
    });

    await ɵtranscribeAudio(core, createAudio());

    expect(sentRequest().headers).toEqual({ authorization: "Bearer token" });
  });

  it("posts base64 JSON to the runtime URL in single-endpoint mode", async () => {
    respondJson(TRANSCRIBED);
    const core = createCore({
      runtimeTransport: "single",
      resolveHeaders: async () => ({ Authorization: "Bearer token" }),
    });

    const result = await ɵtranscribeAudio(
      core,
      createAudio("audio/ogg"),
      "a.ogg",
    );

    expect(result).toEqual(TRANSCRIBED);
    const { url, init, headers } = sentRequest();
    expect(url).toBe(RUNTIME_URL);
    expect(headers).toEqual({
      authorization: "Bearer token",
      "content-type": "application/json",
    });
    expect(JSON.parse(String(init?.body))).toEqual({
      method: "transcribe",
      body: { audio: "YXVkaW8=", mimeType: "audio/ogg", filename: "a.ogg" },
    });
  });

  it("sends audio/webm as the mime type when the blob has no type", async () => {
    respondJson(TRANSCRIBED);

    await ɵtranscribeAudio(
      createCore({ runtimeTransport: "single" }),
      createAudio(""),
    );

    expect(JSON.parse(String(sentRequest().init?.body))).toEqual({
      method: "transcribe",
      body: {
        audio: "YXVkaW8=",
        mimeType: "audio/webm",
        filename: "recording.webm",
      },
    });
  });

  it("resolves the headers again on every call", async () => {
    respondJson(TRANSCRIBED);
    const tokens = ["first", "second"];
    const core = createCore({
      resolveHeaders: async () => ({ Authorization: tokens.shift() ?? "" }),
    });

    await ɵtranscribeAudio(core, createAudio());
    await ɵtranscribeAudio(core, createAudio());

    expect(sentRequest(0).headers).toEqual({ authorization: "first" });
    expect(sentRequest(1).headers).toEqual({ authorization: "second" });
  });

  it.each(["rest", "single"] as const)(
    "sends the core's credentials in %s mode",
    async (runtimeTransport) => {
      respondJson(TRANSCRIBED);

      await ɵtranscribeAudio(
        createCore({ runtimeTransport, credentials: "include" }),
        createAudio(),
      );

      expect(sentRequest().init?.credentials).toBe("include");
    },
  );

  it("leaves credentials out when the core has none", async () => {
    respondJson(TRANSCRIBED);

    await ɵtranscribeAudio(createCore(), createAudio());

    expect(sentRequest().init).not.toHaveProperty("credentials");
  });

  it("throws INVALID_REQUEST without calling fetch when there is no runtime URL", async () => {
    const info = await transcriptionFailure(
      createCore({ runtimeUrl: undefined }),
    );

    expect(info).toEqual({
      code: TranscriptionErrorCode.INVALID_REQUEST,
      message: "Runtime URL is not configured",
      retryable: false,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("lets a header builder failure surface as itself", async () => {
    const core = createCore({
      resolveHeaders: async () => {
        throw new Error("token expired");
      },
    });

    await expect(ɵtranscribeAudio(core, createAudio())).rejects.toThrow(
      "token expired",
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("maps a failed fetch to a retryable NETWORK_ERROR", async () => {
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));

    expect(await transcriptionFailure()).toEqual({
      code: TranscriptionErrorCode.NETWORK_ERROR,
      message: "Failed to fetch",
      retryable: true,
    });
  });

  it("maps a non-JSON server error to a retryable PROVIDER_ERROR", async () => {
    respondWith("<html>oops</html>", {
      status: 502,
      statusText: "Bad Gateway",
    });

    expect(await transcriptionFailure()).toEqual({
      code: TranscriptionErrorCode.PROVIDER_ERROR,
      message: "HTTP 502: Bad Gateway",
      retryable: true,
    });
  });

  it("uses the code, message and retryable flag of a structured error", async () => {
    respondJson(
      {
        error: TranscriptionErrorCode.RATE_LIMITED,
        message: "Slow down",
        retryable: true,
      },
      429,
    );

    expect(await transcriptionFailure()).toEqual({
      code: TranscriptionErrorCode.RATE_LIMITED,
      message: "Slow down",
      retryable: true,
    });
  });

  it("treats a structured error without a retryable flag as not retryable", async () => {
    respondJson(
      { error: TranscriptionErrorCode.AUDIO_TOO_LONG, message: "Too long" },
      503,
    );

    expect(await transcriptionFailure()).toEqual({
      code: TranscriptionErrorCode.AUDIO_TOO_LONG,
      message: "Too long",
      retryable: false,
    });
  });

  it("uses the message of an unstructured JSON client error", async () => {
    respondJson({ message: "Bad audio" }, 400);

    expect(await transcriptionFailure()).toEqual({
      code: TranscriptionErrorCode.PROVIDER_ERROR,
      message: "Bad audio",
      retryable: false,
    });
  });

  it("falls back to a generic message for JSON without a message", async () => {
    respondJson({ detail: "boom" }, 500);

    expect(await transcriptionFailure()).toEqual({
      code: TranscriptionErrorCode.PROVIDER_ERROR,
      message: "Transcription failed",
      retryable: true,
    });
  });
});

describe("ɵtranscriptionErrorMessageKey", () => {
  function errorInfo(
    code: TranscriptionErrorCode,
    retryable = false,
  ): TranscriptionErrorInfo {
    return { code, message: "from the runtime", retryable };
  }

  it.each([
    [TranscriptionErrorCode.RATE_LIMITED, "transcriptionErrorRateLimitedText"],
    [TranscriptionErrorCode.AUTH_FAILED, "transcriptionErrorAuthFailedText"],
    [
      TranscriptionErrorCode.AUDIO_TOO_LONG,
      "transcriptionErrorAudioTooLongText",
    ],
    [
      TranscriptionErrorCode.AUDIO_TOO_SHORT,
      "transcriptionErrorAudioTooShortText",
    ],
    [
      TranscriptionErrorCode.INVALID_AUDIO_FORMAT,
      "transcriptionErrorInvalidAudioFormatText",
    ],
    [
      TranscriptionErrorCode.SERVICE_NOT_CONFIGURED,
      "transcriptionErrorServiceNotConfiguredText",
    ],
    [TranscriptionErrorCode.NETWORK_ERROR, "transcriptionErrorNetworkText"],
  ])("maps %s to %s", (code, key) => {
    expect(ɵtranscriptionErrorMessageKey(errorInfo(code))).toBe(key);
  });

  it("uses the generic label for other retryable errors", () => {
    expect(
      ɵtranscriptionErrorMessageKey(
        errorInfo(TranscriptionErrorCode.PROVIDER_ERROR, true),
      ),
    ).toBe("transcriptionErrorGenericText");
  });

  it("returns null for other non-retryable errors, so the caller shows the message", () => {
    expect(
      ɵtranscriptionErrorMessageKey(
        errorInfo(TranscriptionErrorCode.INVALID_REQUEST),
      ),
    ).toBeNull();
  });
});
