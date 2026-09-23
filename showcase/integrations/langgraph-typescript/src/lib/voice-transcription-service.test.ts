/**
 * Contract for the shared voice transcription service
 * (canonical: showcase/shared/react/demos/voice/transcription-service.ts,
 * materialized byte-identically into every selected integration).
 *
 * The service is driven through the real V2 runtime `/transcribe` route, the
 * same path the browser mic uses. The provider is replaced by a recording
 * `fetch`, so these tests prove what is sent where without a network or key.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CopilotRuntime,
  createCopilotRuntimeHandler,
} from "@copilotkit/runtime/v2";
import {
  GuardedOpenAITranscriptionService,
  resolveTranscriptionBaseUrl,
} from "@/app/demos/voice/transcription-service";

const BASE_PATH = "/api/copilotkit-voice";
const TRANSCRIBE_URL = `http://localhost${BASE_PATH}/transcribe`;

/** Deterministic 0.25 s, 16 kHz mono 16-bit PCM WAV (400 Hz square wave). */
function sampleWav(): Uint8Array {
  const sampleRate = 16_000;
  const samples = sampleRate / 4;
  const view = new DataView(new ArrayBuffer(44 + samples * 2));
  const ascii = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) {
      view.setUint8(offset + i, text.charCodeAt(i));
    }
  };
  ascii(0, "RIFF");
  view.setUint32(4, 36 + samples * 2, true);
  ascii(8, "WAVE");
  ascii(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  ascii(36, "data");
  view.setUint32(40, samples * 2, true);
  for (let i = 0; i < samples; i++) {
    view.setInt16(44 + i * 2, i % 40 < 20 ? 8000 : -8000, true);
  }
  return new Uint8Array(view.buffer);
}

interface ProviderCall {
  url: string;
  authorization: string | null;
  form: FormData;
}

let providerCalls: ProviderCall[];

beforeEach(() => {
  providerCalls = [];
  // The OpenAI SDK captures global fetch when the client is constructed, so
  // stub it before each service is built.
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, {
        ...init,
        duplex: "half",
      } as RequestInit);
      providerCalls.push({
        url: request.url,
        authorization: request.headers.get("authorization"),
        form: await request.formData(),
      });
      return new Response(JSON.stringify({ text: "provider transcript" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function voiceHandler(env: Record<string, string | undefined>) {
  const runtime = new CopilotRuntime({
    // @ts-ignore -- /transcribe never resolves an agent; see the voice routes
    // for the published agents type mismatch.
    agents: {},
    transcriptionService: new GuardedOpenAITranscriptionService(env),
  });
  return createCopilotRuntimeHandler({ runtime, basePath: BASE_PATH });
}

function transcribe(
  handler: (req: Request) => Promise<Response>,
  audio?: File,
): Promise<Response> {
  const body = new FormData();
  if (audio) body.append("audio", audio);
  return handler(new Request(TRANSCRIBE_URL, { method: "POST", body }));
}

const wavFile = () =>
  new File([sampleWav()], "sample.wav", { type: "audio/wav" });

// docker-compose.local.yml and Railway set these for every integration.
const AIMOCK_CHAT_ENV = {
  OPENAI_BASE_URL: "http://aimock:4010/v1",
  AIMOCK_URL: "http://aimock:4010",
};

describe("resolveTranscriptionBaseUrl", () => {
  it("sends recordings to OpenAI even when chat is routed to AIMock", () => {
    expect(resolveTranscriptionBaseUrl(AIMOCK_CHAT_ENV)).toBe(
      "https://api.openai.com/v1",
    );
    expect(resolveTranscriptionBaseUrl({})).toBe("https://api.openai.com/v1");
  });

  it("uses OPENAI_TRANSCRIPTION_BASE_URL only when it is set explicitly", () => {
    expect(
      resolveTranscriptionBaseUrl({
        ...AIMOCK_CHAT_ENV,
        OPENAI_TRANSCRIPTION_BASE_URL: " http://127.0.0.1:4010/v1 ",
      }),
    ).toBe("http://127.0.0.1:4010/v1");
    expect(
      resolveTranscriptionBaseUrl({ OPENAI_TRANSCRIPTION_BASE_URL: "  " }),
    ).toBe("https://api.openai.com/v1");
  });
});

describe("GuardedOpenAITranscriptionService behind POST /transcribe", () => {
  it("forwards the recorded bytes unchanged to OpenAI with the configured key", async () => {
    const handler = voiceHandler({
      ...AIMOCK_CHAT_ENV,
      OPENAI_API_KEY: "sk-local-test",
    });

    const response = await transcribe(handler, wavFile());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      text: "provider transcript",
    });
    expect(providerCalls).toHaveLength(1);
    const [call] = providerCalls;
    expect(call!.url).toBe("https://api.openai.com/v1/audio/transcriptions");
    expect(call!.authorization).toBe("Bearer sk-local-test");
    expect(call!.form.get("model")).toBe("whisper-1");
    const sent = call!.form.get("file");
    expect(sent).toBeInstanceOf(File);
    expect(new Uint8Array(await (sent as File).arrayBuffer())).toEqual(
      sampleWav(),
    );
  });

  it("reaches AIMock only through the explicit transcription override", async () => {
    const handler = voiceHandler({
      ...AIMOCK_CHAT_ENV,
      OPENAI_API_KEY: "sk-mock",
      OPENAI_TRANSCRIPTION_BASE_URL: "http://127.0.0.1:4010/v1",
    });

    const response = await transcribe(handler, wavFile());

    expect(response.status).toBe(200);
    expect(providerCalls.map((call) => call.url)).toEqual([
      "http://127.0.0.1:4010/v1/audio/transcriptions",
    ]);
  });

  it("answers 401 auth_failed without a provider call when OPENAI_API_KEY is missing", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const handler = voiceHandler({ ...AIMOCK_CHAT_ENV, OPENAI_API_KEY: " " });

    const response = await transcribe(handler, wavFile());

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({
      error: "auth_failed",
    });
    expect(providerCalls).toHaveLength(0);
    expect(logged).toHaveBeenCalledWith(
      expect.stringContaining("OPENAI_API_KEY is not set"),
    );
  });

  it("answers 400 invalid_request without a provider call when the audio part is missing", async () => {
    const handler = voiceHandler({ OPENAI_API_KEY: "sk-local-test" });

    const response = await transcribe(handler);

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: "invalid_request",
    });
    expect(providerCalls).toHaveLength(0);
  });

  it("rejects a 0-byte upload without a provider call", async () => {
    const handler = voiceHandler({ OPENAI_API_KEY: "sk-local-test" });

    const response = await transcribe(
      handler,
      new File([], "recording.webm", { type: "audio/webm" }),
    );

    // Runtime 1.71.1 forwards a 0-byte `audio` part to the service and maps
    // any error the service throws by its message text; none of its 4xx
    // markers fits an empty recording, so this surfaces as provider_error
    // (500) with the service's message. A 4xx needs the runtime itself to
    // reject empty audio (TranscriptionErrors.audioTooShort).
    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toMatchObject({
      error: "provider_error",
      message:
        "Audio upload is empty (0 bytes); nothing was sent for transcription.",
    });
    expect(providerCalls).toHaveLength(0);
  });
});
