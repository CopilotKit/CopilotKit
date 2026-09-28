/**
 * D5 — voice script.
 *
 * Drives `/demos/voice` through a single turn covering audio transcription
 * via the sample audio button. The demo (see
 * `showcase/integrations/langgraph-python/src/app/demos/voice/page.tsx`)
 * exposes a "Play sample" button (`data-testid="voice-sample-audio-button"`)
 * that fetches a bundled WAV, POSTs it to the runtime's `/transcribe`
 * endpoint, and injects the transcribed text ("What is the weather in
 * Tokyo?") into the chat composer via a native value setter + synthetic
 * input event.
 *
 * The script clicks the sample audio button via `preFill`, then uses
 * `skipFill: true` so the conversation runner does NOT overwrite the
 * transcribed text with `page.fill()`. Instead the runner waits for the
 * textarea to be populated (by the transcription callback), then presses
 * Enter.
 *
 * Aimock returns a canned weather response keyed off the transcribed
 * question. The assertion verifies the assistant transcript references
 * weather/Tokyo content.
 */

import { registerD5Script } from "../helpers/d5-registry.js";
import type { D5BuildContext } from "../helpers/d5-registry.js";
import type { ConversationTurn, Page } from "../helpers/conversation-runner.js";

export const SAMPLE_AUDIO_BUTTON_SELECTOR =
  '[data-testid="voice-sample-audio-button"]';

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
 * Click the sample audio button and wait for the transcription to populate
 * the chat textarea. The button triggers an async fetch → transcribe →
 * inject cycle, so we poll the textarea value until non-empty or the
 * timeout expires.
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
