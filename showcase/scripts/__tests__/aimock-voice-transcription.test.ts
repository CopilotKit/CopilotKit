import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { createRequire } from "node:module";
import net from "node:net";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * HTTP checks for the voice transcription fixture
 * (showcase/aimock/shared/voice-transcription.json) against one real AIMock
 * process started the way docker-compose.local.yml starts it: the same four
 * fixture directories and `--validate-on-load`, plus `--strict` so an
 * unmatched upload gets an error instead of a 404 fallthrough.
 *
 * What AIMock 1.37.4 can and cannot verify for `POST /v1/audio/transcriptions`
 * (dist/transcription.js): it reads only the multipart `model` and
 * `response_format` fields and the `X-AIMock-Context` header. The request it
 * matches fixtures against is `{ model, messages: [], _endpointType, _context }`
 * with no trace of the uploaded file, and JSON fixtures cannot carry a
 * predicate. So a fixture can require endpoint, model and context, but it
 * cannot require particular audio bytes, a non-empty file or a file part at
 * all. The last block pins that limitation instead of pretending otherwise.
 * Missing and empty uploads are rejected before any provider call by the
 * runtime and the shared voice transcription service; see
 * showcase/integrations/langgraph-typescript/src/lib/voice-transcription-service.test.ts.
 */

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
const FIXTURE_DIRS = ["shared", "d4", "d5-recorded", "d6"].map((dir) =>
  path.join(REPO_ROOT, "showcase/aimock", dir),
);
const CONTEXT = "voice-sample-wav";
const TRANSCRIPT = "What is the weather in Tokyo?";

// The `llmock` bin that the root `pnpm aimock` script runs, spawned by path so
// the test owns the server's PID.
const LLMOCK_CLI = path.join(
  path.dirname(createRequire(import.meta.url).resolve("@copilotkit/aimock")),
  "cli.js",
);

/** Deterministic 0.25 s, 16 kHz mono 16-bit PCM WAV (400 Hz square wave). */
function sampleWav(): File {
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
  return new File([view.buffer], "sample.wav", { type: "audio/wav" });
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as net.AddressInfo;
      server.close(() => resolve(port));
    });
  });
}

let aimock: ChildProcess | undefined;
let baseUrl = "";
let output = "";

beforeAll(async () => {
  const port = await freePort();
  baseUrl = `http://127.0.0.1:${port}`;
  const args = [LLMOCK_CLI, "--host", "127.0.0.1", "--port", String(port)];
  for (const dir of FIXTURE_DIRS) args.push("--fixtures", dir);
  args.push("--validate-on-load", "--strict", "--log-level", "warn");

  const child = spawn(process.execPath, args, {
    cwd: REPO_ROOT,
    stdio: ["ignore", "pipe", "pipe"],
  });
  aimock = child;
  child.stdout?.on("data", (chunk) => (output += chunk));
  child.stderr?.on("data", (chunk) => (output += chunk));

  const deadline = Date.now() + 25_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) break;
    try {
      if ((await fetch(`${baseUrl}/health`)).ok) return;
    } catch {
      // not listening yet
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`AIMock did not become healthy on ${baseUrl}:\n${output}`);
});

afterAll(async () => {
  if (!aimock || aimock.exitCode !== null) return;
  const exited = new Promise((resolve) => aimock!.once("exit", resolve));
  aimock.kill("SIGTERM");
  await exited;
});

async function upload(options: {
  context?: string;
  model?: string;
  file?: Blob;
}): Promise<{ status: number; body: unknown }> {
  const form = new FormData();
  if (options.file) form.append("file", options.file, "sample.wav");
  form.append("model", options.model ?? "whisper-1");
  const response = await fetch(`${baseUrl}/v1/audio/transcriptions`, {
    method: "POST",
    headers: options.context ? { "X-AIMock-Context": options.context } : {},
    body: form,
  });
  return { status: response.status, body: await response.json() };
}

const STRICT_NO_MATCH = {
  error: {
    message: "Strict mode: no fixture matched",
    type: "invalid_request_error",
    code: "no_fixture_match",
  },
};

describe("AIMock voice transcription fixture", () => {
  it("returns the fixture transcript for the WAV sample on its own context", async () => {
    await expect(
      upload({ context: CONTEXT, file: sampleWav() }),
    ).resolves.toEqual({ status: 200, body: { text: TRANSCRIPT } });
  });

  it.each([
    ["no X-AIMock-Context header", undefined],
    ["an integration's D6 context", "langgraph-python"],
  ])(
    "answers an upload with %s with a strict no-match error, never the transcript",
    async (_label, context) => {
      await expect(upload({ context, file: sampleWav() })).resolves.toEqual({
        status: 503,
        body: STRICT_NO_MATCH,
      });
    },
  );

  it("answers a different transcription model with a strict no-match error", async () => {
    await expect(
      upload({
        context: CONTEXT,
        model: "gpt-4o-transcribe",
        file: sampleWav(),
      }),
    ).resolves.toEqual({ status: 503, body: STRICT_NO_MATCH });
  });
});

describe("AIMock 1.37.4 limitation: the uploaded file part is never inspected", () => {
  // These are NOT desired behavior. They pin what AIMock does today so the
  // fixture is never mistaken for audio verification; if an AIMock upgrade
  // starts matching on the file part, these fail and the fixture should be
  // tightened to require it.
  it.each([
    ["non-audio bytes", new Blob(["not audio"], { type: "audio/wav" })],
    ["a 0-byte file", new Blob([], { type: "audio/wav" })],
    ["no file part", undefined],
  ])(
    "still returns the fixture transcript for %s on the fixture's context",
    async (_label, file) => {
      await expect(upload({ context: CONTEXT, file })).resolves.toEqual({
        status: 200,
        body: { text: TRANSCRIPT },
      });
    },
  );
});
