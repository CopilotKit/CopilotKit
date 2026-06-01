/**
 * D5 — shared-state-streaming script.
 *
 * Drives `/demos/shared-state-streaming`. The agent streams tokens
 * into shared `state.document.content`; the frontend's `DocumentView`
 * subscribes via `useAgent` and re-renders on every chunk. Live UI
 * signals expose the in-flight stream:
 *
 *   - `[data-testid="document-live-badge"]` is mounted IFF the agent
 *     is currently running (token frames in flight).
 *   - `[data-testid="document-char-count"]` text updates per chunk.
 *
 * Genuine assertion: for each suggestion-pill prompt, capture the
 * `[data-testid="document-content"]` text BEFORE the pill is sent, then
 * send the pill and after settle assert the document text either grew
 * substantively (delta ≥ STREAMING_MIN_FINAL_CHARS) or changed
 * outright. Three pills exercised sequentially in one probe.
 *
 * The per-turn baseline is essential: `[data-testid="document-content"]`
 * is sticky DOM that carries content from pill N into pill N+1's
 * pre-fill state, so a regression where pill 2 produces NO new content
 * could otherwise pass on pill 1's leftover output. The runner's
 * `preFill` hook reads the baseline before the message is sent.
 *
 * NOTE: this probe does NOT observe mid-stream chunking — the runner
 * waits for the assistant-message DOM count to settle before invoking
 * the assertion, by which point the stream has already completed. A
 * regression where the agent emits the entire document in a single
 * non-streaming chunk is NOT caught here; that contract requires
 * hooking the runner's settle window and is tracked as a follow-up.
 */

import {
  registerD5Script,
  type D5BuildContext,
} from "../helpers/d5-registry.js";
import type { ConversationTurn, Page } from "../helpers/conversation-runner.js";
import { FIRST_SIGNAL_TIMEOUT_MS, waitForTestId } from "./_genuine-shared.js";

/** Pill prompts MUST mirror `shared-state-streaming/suggestions.ts`. */
export const SHARED_STATE_STREAMING_PILLS = [
  {
    tag: "autumn-poem",
    prompt: "Write a short poem about autumn leaves.",
  },
  {
    tag: "decline-email",
    prompt: "Draft a polite email declining a meeting next Tuesday afternoon.",
  },
  {
    tag: "quantum-explainer",
    prompt:
      "Write a 2-paragraph explanation of quantum computing for a curious teenager.",
  },
] as const;

/** Minimum final char count for the document to count as
 *  "non-trivially streamed". Calibrated against fixture sample copy
 *  (~120 chars); real LLM output is much longer. */
export const STREAMING_MIN_FINAL_CHARS = 80;

/** Read `[data-testid="document-content"]` text and live-badge
 *  presence. Returns the full text so callers can compare baseline
 *  vs. post-settle for content-changed detection (a delta-only check
 *  misses a regression where the document is replaced by content of
 *  the same length). */
async function readDocumentState(page: Page): Promise<{
  charCount: number;
  text: string;
  liveBadgePresent: boolean;
}> {
  return (await page.evaluate(() => {
    const win = globalThis as unknown as {
      document: {
        querySelector(sel: string): {
          textContent: string | null;
        } | null;
      };
    };
    const content = win.document.querySelector(
      '[data-testid="document-content"]',
    );
    const live = win.document.querySelector(
      '[data-testid="document-live-badge"]',
    );
    const text = content?.textContent ?? "";
    return { charCount: text.length, text, liveBadgePresent: !!live };
  })) as { charCount: number; text: string; liveBadgePresent: boolean };
}

/** Per-pill baseline reference. The `preFill` hook captures the
 *  pre-pill document state into this object; the assertion reads it
 *  to compute "did this pill actually produce new content". Closing
 *  over the same ref across both callbacks is the simplest way to
 *  thread state without depending on runner-internal context. */
export interface StreamingBaselineRef {
  charCount: number;
  text: string;
  captured: boolean;
}

/** Build the `preFill` hook that captures the document-content
 *  baseline before the pill is sent. The runner invokes this hook
 *  once per turn, before the chat input fill+press. */
export function buildBaselineCapture(
  ref: StreamingBaselineRef,
): (page: Page) => Promise<void> {
  return async (page: Page): Promise<void> => {
    const state = await readDocumentState(page);
    ref.charCount = state.charCount;
    ref.text = state.text;
    ref.captured = true;
  };
}

/** Build a per-pill assertion. The runner waits for the
 *  assistant-message DOM count to settle before invoking us, which
 *  means by the time we run the stream is already complete. To
 *  detect "did THIS pill produce new content" (vs. trivially passing
 *  on pill N-1's leftover document text), we compare against the
 *  pre-pill baseline captured in `ref` by the `preFill` hook.
 *
 *  Pass condition (either is sufficient):
 *    - `delta >= STREAMING_MIN_FINAL_CHARS` (substantive new content
 *      appended), OR
 *    - `text !== baseline.text` AND `charCount >= STREAMING_MIN_FINAL_CHARS`
 *      (document was REPLACED with substantive content of similar
 *      size — covers the case where the pill rewrites rather than
 *      appends).
 */
export function buildStreamingAssertion(
  pillTag: string,
  ref: StreamingBaselineRef,
): (page: Page) => Promise<void> {
  return async (page: Page): Promise<void> => {
    await waitForTestId(
      page,
      "document-view",
      FIRST_SIGNAL_TIMEOUT_MS,
      `shared-state-streaming-${pillTag}`,
    );
    if (!ref.captured) {
      throw new Error(
        `shared-state-streaming-${pillTag}: baseline was not captured by preFill (test wiring error)`,
      );
    }
    // Poll the document content briefly to allow any final settle.
    const deadline = Date.now() + 5_000;
    let last = { charCount: 0, text: "", liveBadgePresent: false };
    while (Date.now() < deadline) {
      last = await readDocumentState(page);
      const delta = last.charCount - ref.charCount;
      const replaced =
        last.text !== ref.text && last.charCount >= STREAMING_MIN_FINAL_CHARS;
      if (delta >= STREAMING_MIN_FINAL_CHARS || replaced) return;
      await new Promise((r) => setTimeout(r, 200));
    }
    const delta = last.charCount - ref.charCount;
    throw new Error(
      `shared-state-streaming-${pillTag}: document content did not change substantively ` +
        `(baseline=${ref.charCount} chars, final=${last.charCount} chars, delta=${delta}; ` +
        `need delta ≥ ${STREAMING_MIN_FINAL_CHARS} or replaced text ≥ ${STREAMING_MIN_FINAL_CHARS}); ` +
        `live-badge=${last.liveBadgePresent}`,
    );
  };
}

export function buildTurns(_ctx: D5BuildContext): ConversationTurn[] {
  return SHARED_STATE_STREAMING_PILLS.map(({ tag, prompt }) => {
    const ref: StreamingBaselineRef = {
      charCount: 0,
      text: "",
      captured: false,
    };
    return {
      input: prompt,
      preFill: buildBaselineCapture(ref),
      assertions: buildStreamingAssertion(tag, ref),
      responseTimeoutMs: 60_000,
    };
  });
}

registerD5Script({
  featureTypes: ["shared-state-streaming"],
  fixtureFile: "shared-state-streaming.json",
  buildTurns,
});
