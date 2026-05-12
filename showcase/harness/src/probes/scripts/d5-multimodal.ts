/**
 * D5 — multimodal script.
 *
 * Drives `/demos/multimodal` through two turns covering image + PDF
 * uploads. The demo (see
 * `showcase/integrations/langgraph-python/src/app/demos/multimodal/page.tsx`)
 * exposes "Try with sample image" / "Try with sample PDF" buttons that
 * inject bundled fixtures via DataTransfer + dispatch — the SAME pipeline
 * the paperclip path uses. The script clicks the appropriate button
 * before each user message via the runner's `preFill` hook, which queues
 * the attachment, then the regular fill+press flow sends both message +
 * attachment together.
 *
 * Aimock returns canned responses keyed off unique substrings. The
 * assertion verifies the assistant transcript references the attachment
 * (substring "image" / "document" present in the assistant's reply).
 */

import {
  registerD5Script,
  type D5BuildContext,
} from "../helpers/d5-registry.js";
import type { ConversationTurn, Page } from "../helpers/conversation-runner.js";

export const SAMPLE_IMAGE_BUTTON_SELECTOR =
  '[data-testid="multimodal-sample-image-button"]';
export const SAMPLE_PDF_BUTTON_SELECTOR =
  '[data-testid="multimodal-sample-pdf-button"]';

const SAMPLE_BUTTON_TIMEOUT_MS = 5_000;
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

/** Click a sample-attachment button, throwing with a clear error if it
 *  isn't visible (proves the demo didn't render the sample buttons —
 *  a regression in their wiring would otherwise look like a generic
 *  "no response" failure). */
async function clickSampleButton(page: Page, selector: string): Promise<void> {
  try {
    await page.waitForSelector(selector, {
      state: "visible",
      timeout: SAMPLE_BUTTON_TIMEOUT_MS,
    });
  } catch {
    throw new Error(
      `multimodal: sample button ${selector} not visible — page failed to render the sample-attachment-buttons component`,
    );
  }
  const clickable = page as unknown as {
    click?: (sel: string, opts?: { timeout?: number }) => Promise<void>;
  };
  if (typeof clickable.click !== "function") {
    throw new Error(
      "multimodal: page does not support click() — cannot inject sample attachment",
    );
  }
  await clickable.click(selector, { timeout: 5_000 });
}

/** Build the assertion for an image / pdf turn. Verifies the assistant
 *  transcript contains the expected modality-keyword. */
function buildModalityAssertion(
  modalityKeyword: string,
): (page: Page) => Promise<void> {
  return async (page: Page): Promise<void> => {
    const deadline = Date.now() + ASSISTANT_TRANSCRIPT_TIMEOUT_MS;
    let lastTranscript = "";
    while (Date.now() < deadline) {
      lastTranscript = await readAssistantTranscript(page);
      if (lastTranscript.includes(modalityKeyword)) return;
      await new Promise<void>((r) => setTimeout(r, 200));
    }
    throw new Error(
      `multimodal: assistant transcript missing keyword "${modalityKeyword}" — got "${lastTranscript.slice(0, 200)}"`,
    );
  };
}

/**
 * Pre-fill hook for an attachment turn. Clicks the sample button BEFORE
 * the runner fills the chat input on the next turn. We expose this as a
 * separate function so the script's `buildTurns` can reference each
 * turn's attachment selector cleanly.
 */
export async function preTurnAttachImage(page: Page): Promise<void> {
  await clickSampleButton(page, SAMPLE_IMAGE_BUTTON_SELECTOR);
}
export async function preTurnAttachPdf(page: Page): Promise<void> {
  await clickSampleButton(page, SAMPLE_PDF_BUTTON_SELECTOR);
}

export function buildTurns(_ctx: D5BuildContext): ConversationTurn[] {
  // `skipSend: true` because the sample buttons auto-send the user
  // message via `agent.addMessage` + `copilotkit.runAgent` (see
  // showcase/integrations/langgraph-python/src/app/demos/multimodal/
  // sample-attachment-buttons.tsx). Without `skipSend` the runner
  // would ALSO type `input` and press Enter, sending a second user
  // message that competes with the in-flight image upload — the v1
  // LangGraph runtime stream gets tangled and neither response makes
  // it back to the UI. `input` is kept as a descriptive label for
  // logs only. Timeout bumped to 60s to cover image-attachment payload
  // round-trip latency (the e2e Playwright spec uses 60-90s for the
  // same path — see tests/e2e/multimodal.spec.ts).
  return [
    {
      input: "image-sample-button (auto-sent)",
      preFill: preTurnAttachImage,
      skipSend: true,
      responseTimeoutMs: 60_000,
      assertions: buildModalityAssertion("image"),
    },
    {
      input: "pdf-sample-button (auto-sent)",
      preFill: preTurnAttachPdf,
      skipSend: true,
      responseTimeoutMs: 60_000,
      assertions: buildModalityAssertion("document"),
    },
  ];
}

registerD5Script({
  featureTypes: ["multimodal"],
  fixtureFile: "multimodal.json",
  buildTurns,
});
