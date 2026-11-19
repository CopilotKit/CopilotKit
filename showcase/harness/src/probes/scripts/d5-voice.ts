/**
 * D5 — voice script.
 *
 * Drives `/demos/voice` through a single turn. The demo (see
 * `showcase/integrations/langgraph-python/src/app/demos/voice/page.tsx`)
 * has a sample button (`data-testid="voice-sample-audio-button"`) that
 * injects the canned phrase "What is the weather in Tokyo?" into the chat
 * composer without calling the runtime; the mic is the path that records
 * audio and posts it to the voice runtime's `/transcribe`.
 *
 * Transcription: before clicking the sample button, the script asks the
 * voice runtime's `/info` whether transcription is enabled. Integrations
 * enable it only with a dedicated `OPENAI_TRANSCRIPTION_API_KEY`, so it is
 * off unless a deployment or test stack configures it. When it is on, the
 * script fetches the page's bundled sample (`/demo-audio/sample.wav`, the
 * same phrase spoken) and posts it to `/transcribe` from the page, so the
 * request carries the probe's headers like any other page request; the
 * runtime must answer 200 with a transcript that mentions Tokyo.
 *
 * The script clicks the sample audio button via `preFill`, then uses
 * `skipFill: true` so the conversation runner does NOT overwrite the
 * injected text with `page.fill()`. Instead the runner waits for the
 * textarea to be populated, then presses Enter.
 *
 * Aimock returns a canned weather response keyed off the question. The
 * assertion verifies the assistant transcript references weather/Tokyo
 * content.
 */

import { registerD5Script } from "../helpers/d5-registry.js";
import type { D5BuildContext } from "../helpers/d5-registry.js";
import type { ConversationTurn, Page } from "../helpers/conversation-runner.js";

export const SAMPLE_AUDIO_BUTTON_SELECTOR =
  '[data-testid="voice-sample-audio-button"]';

/** The voice demo's runtime (`runtimeUrl` of `/demos/voice`). */
export const VOICE_RUNTIME_PATH = "/api/copilotkit-voice";
/** The spoken sample every voice demo bundles in `public/demo-audio`. */
export const SAMPLE_AUDIO_PATH = "/demo-audio/sample.wav";

/** What the in-page transcription check found. */
export interface TranscriptionCheck {
  /** Whether the runtime's `/info` reports transcription enabled. */
  enabled: boolean;
  /** HTTP status of `/transcribe`, when it was called. */
  status?: number;
  /** The transcript, or the start of the response body when it has none. */
  text?: string;
  /** Why the upload could not be made. */
  error?: string;
}

const SAMPLE_BUTTON_TIMEOUT_MS = 10_000;
const TRANSCRIPTION_TIMEOUT_MS = 15_000;
const ASSISTANT_TRANSCRIPT_TIMEOUT_MS = 5_000;

/** Read concatenated assistant transcript text (lowercased). */
async function readAssistantTranscript(page: Page): Promise<string> {
  return (await page.evaluate(() => {
    const win = globalThis as unknown as {
      document: {
        querySelectorAll(
          sel: string,
        ): ArrayLike<{ textContent: string | null }>;
      };
    };
    const sels = [
      '[data-testid="copilot-assistant-message"]',
      '[role="article"]:not([data-message-role="user"])',
      '[data-message-role="assistant"]',
    ];
    let nodes: ArrayLike<{ textContent: string | null }> = { length: 0 };
    for (const s of sels) {
      const found = win.document.querySelectorAll(s);
      if (found.length > 0) {
        nodes = found;
        break;
      }
    }
    let acc = "";
    for (let i = 0; i < nodes.length; i++) {
      acc += " " + (nodes[i]!.textContent ?? "");
    }
    return acc.toLowerCase();
  })) as string;
}

/**
 * When the voice runtime has transcription enabled, upload the bundled
 * sample to its `/transcribe` from the page and require the sample's
 * phrase back. Runs in the page so the requests carry the probe's headers
 * (`x-aimock-context`, `x-test-id`, …) as the demo's own requests do.
 */
async function checkTranscriptionUpload(page: Page): Promise<void> {
  // The page function is self-contained: the D6 driver's page adapter calls
  // `page.evaluate(fn)` without an argument, so the paths are literals here
  // (VOICE_RUNTIME_PATH and SAMPLE_AUDIO_PATH; the tests pin them).
  const result = (await page.evaluate(async () => {
    const runtime = "/api/copilotkit-voice";
    const sample = "/demo-audio/sample.wav";
    let enabled = false;
    try {
      const res = await fetch(`${runtime}/info`);
      if (res.ok) {
        const info = (await res.json()) as {
          audioFileTranscriptionEnabled?: boolean;
        };
        enabled = info.audioFileTranscriptionEnabled === true;
      }
    } catch {
      enabled = false;
    }
    if (!enabled) return { enabled: false };
    const audio = await fetch(sample);
    if (!audio.ok) {
      return { enabled: true, error: `${sample} answered ${audio.status}` };
    }
    const form = new FormData();
    form.append(
      "audio",
      new File([await audio.blob()], "sample.wav", { type: "audio/wav" }),
    );
    const res = await fetch(`${runtime}/transcribe`, {
      method: "POST",
      body: form,
    });
    const body = await res.text();
    let text: string | undefined;
    try {
      text = (JSON.parse(body) as { text?: string }).text;
    } catch {
      text = undefined;
    }
    return {
      enabled: true,
      status: res.status,
      text: text ?? body.slice(0, 200),
    };
  })) as TranscriptionCheck;

  if (!result.enabled) return;
  if (result.error) throw new Error(`voice: ${result.error}`);
  if (result.status !== 200 || !/tokyo/i.test(result.text ?? "")) {
    throw new Error(
      `voice: transcribing the bundled sample returned ${result.status}: "${result.text ?? ""}"`,
    );
  }
}

/**
 * Check the transcription upload (when the runtime has it), then click the
 * sample audio button and wait for its phrase to populate the chat
 * textarea, polling the textarea value until non-empty or the timeout
 * expires.
 */
async function clickSampleAudioAndWaitForTranscription(
  page: Page,
): Promise<void> {
  // Wait for the button to be visible.
  try {
    await page.waitForSelector(SAMPLE_AUDIO_BUTTON_SELECTOR, {
      state: "visible",
      timeout: SAMPLE_BUTTON_TIMEOUT_MS,
    });
  } catch {
    throw new Error(
      `voice: sample audio button ${SAMPLE_AUDIO_BUTTON_SELECTOR} not visible — page failed to render the voice demo`,
    );
  }

  await checkTranscriptionUpload(page);

  // Click the button.
  const clickable = page as unknown as {
    click?: (sel: string, opts?: { timeout?: number }) => Promise<void>;
  };
  if (typeof clickable.click !== "function") {
    throw new Error(
      "voice: page does not support click() — cannot trigger sample audio",
    );
  }
  await clickable.click(SAMPLE_AUDIO_BUTTON_SELECTOR, { timeout: 5_000 });

  // Wait for the textarea to be populated with transcribed text.
  // The transcription endpoint (aimock) returns "What is the weather in Tokyo?"
  const deadline = Date.now() + TRANSCRIPTION_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const value = (await page.evaluate(() => {
      const win = globalThis as unknown as {
        document: {
          querySelector(sel: string): { value?: string } | null;
        };
      };
      const el = win.document.querySelector(
        '[data-testid="copilot-chat-textarea"]',
      );
      return el?.value ?? "";
    })) as string;
    if (value.trim().length > 0) return;
    await new Promise<void>((r) => setTimeout(r, 200));
  }
  throw new Error(
    `voice: textarea not populated within ${TRANSCRIPTION_TIMEOUT_MS}ms after clicking sample audio button`,
  );
}

/**
 * Build assertion for the weather response. Verifies the assistant
 * transcript contains weather-related content for Tokyo.
 */
function buildWeatherAssertion(): (page: Page) => Promise<void> {
  return async (page: Page): Promise<void> => {
    const deadline = Date.now() + ASSISTANT_TRANSCRIPT_TIMEOUT_MS;
    let lastTranscript = "";
    while (Date.now() < deadline) {
      lastTranscript = await readAssistantTranscript(page);
      if (
        lastTranscript.includes("tokyo") ||
        lastTranscript.includes("weather") ||
        lastTranscript.includes("temperature")
      ) {
        return;
      }
      await new Promise<void>((r) => setTimeout(r, 200));
    }
    throw new Error(
      `voice: assistant transcript missing weather/Tokyo content — got "${lastTranscript.slice(0, 200)}"`,
    );
  };
}

export function buildTurns(_ctx: D5BuildContext): ConversationTurn[] {
  return [
    {
      // preFill clicks the sample audio button and waits for transcription
      // to populate the textarea with "What is the weather in Tokyo?"
      preFill: clickSampleAudioAndWaitForTranscription,
      // skipFill: true tells the runner to skip page.fill() — the
      // transcription callback already populated the textarea. The runner
      // will wait for the textarea to have content, then press Enter.
      skipFill: true,
      // input is empty because preFill + transcription populated the textarea.
      input: "",
      assertions: buildWeatherAssertion(),
    },
  ];
}

registerD5Script({
  featureTypes: ["voice"],
  fixtureFile: "d5-all.json",
  buildTurns,
});
