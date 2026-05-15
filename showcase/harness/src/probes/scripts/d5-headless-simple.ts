/**
 * D5 — headless-simple script.
 *
 * Drives `/demos/headless-simple` through one chip-driven turn and
 * verifies the headless template's text round-trip works end-to-end.
 *
 * The previous incarnation (`d5-gen-ui-headless.ts`, removed) probed
 * a `show_card` `useComponent` flow and a "largest continent" text
 * fallback. Both are gone in the post-refactor demo — `headless-simple`
 * is now a deliberately minimal "two hooks, one shadcn shell" template
 * with chip prompts that round-trip plain text. `headless-complete`
 * (separate D5 cell) covers the full gen-UI surface.
 *
 * Single turn:
 *   1. Click "Say hello in one short sentence." chip in the empty state
 *      (the chip's onClick calls `send(text)` directly — bypasses the
 *      composer textarea path).
 *   2. Wait for `[data-testid="headless-message-assistant"]` to mount
 *      with non-empty content. The bubble carries `data-message-role`
 *      so the runner's settle cascade can resolve it independently.
 */

import { registerD5Script } from "../helpers/d5-registry.js";
import type { D5BuildContext } from "../helpers/d5-registry.js";
import type { ConversationTurn, Page } from "../helpers/conversation-runner.js";

/** Selector marking a rendered assistant text bubble in headless-simple. */
export const ASSISTANT_BUBBLE_SELECTOR =
  '[data-testid="headless-message-assistant"]';

/** Visible label of the chip we click to drive turn 1. Mirrors the
 *  `SAMPLES[0]` literal in `headless-simple/empty-state.tsx` — change
 *  one and the other has to match or this probe goes red. */
const SAMPLE_CHIP_LABEL = "Say hello in one short sentence.";

/** Wall-clock for the bubble to mount + populate after the chip click.
 *  Generous because a cold-start container needs time to handshake with
 *  the agent and stream the first content delta. */
const ASSISTANT_TIMEOUT_MS = 30_000;

/** Click a sample chip by its visible label. The runner's structural
 *  Page shim doesn't expose `click()` (Playwright's real Page does);
 *  the driver's wrapper passes it through, so we narrow at call time
 *  with a runtime guard — same pattern as `_beautiful-chat-shared.ts`. */
async function clickChip(page: Page, label: string): Promise<void> {
  const candidate = page as Page & {
    click?(selector: string, opts?: { timeout?: number }): Promise<void>;
  };
  if (typeof candidate.click !== "function") {
    throw new Error(
      "headless-simple: page.click is not available — runner must " +
        "expose click() for chip-driven turns",
    );
  }
  // Playwright's `text=` engine matches button text exactly. The literal
  // label includes its trailing period so we match the chip and not the
  // page heading or any partial.
  await candidate.click(`button >> text="${label}"`, { timeout: 10_000 });
}

/** Read the text content of the latest assistant bubble. Returns the
 *  empty string if no bubble matches yet — the polling loop will retry. */
async function readLatestAssistantText(page: Page): Promise<string> {
  return await page.evaluate(() => {
    const win = globalThis as unknown as {
      document: {
        querySelectorAll(sel: string): {
          length: number;
          [index: number]: { textContent: string | null };
        };
      };
    };
    const nodes = win.document.querySelectorAll(
      '[data-testid="headless-message-assistant"]',
    );
    if (nodes.length === 0) return "";
    return (nodes[nodes.length - 1]!.textContent ?? "").trim();
  });
}

export function buildTurns(_ctx: D5BuildContext): ConversationTurn[] {
  return [
    {
      // Empty input + chip click via preFill. The chip's onClick calls
      // `send(text)` directly; the runner's fill+press is a no-op
      // because the composer's send button is disabled on empty input.
      input: "",
      preFill: async (page) => {
        console.debug("[d5-headless-simple] turn 1: clicking sample chip", {
          label: SAMPLE_CHIP_LABEL,
        });
        await clickChip(page, SAMPLE_CHIP_LABEL);
      },
      assertions: async (page) => {
        // Wait for the assistant bubble to mount.
        try {
          await page.waitForSelector(ASSISTANT_BUBBLE_SELECTOR, {
            state: "visible",
            timeout: ASSISTANT_TIMEOUT_MS,
          });
        } catch {
          throw new Error(
            `headless-simple: assistant bubble (${ASSISTANT_BUBBLE_SELECTOR}) did not mount within ${ASSISTANT_TIMEOUT_MS}ms — chip click may not have submitted, agent may not have responded`,
          );
        }
        // Then poll for non-empty content (mount can race with first
        // content delta — the bubble can be empty for a few ticks).
        const deadline = Date.now() + 5_000;
        let text = "";
        while (Date.now() < deadline) {
          text = await readLatestAssistantText(page);
          if (text.length > 0) break;
          await new Promise((r) => setTimeout(r, 200));
        }
        if (text.length === 0) {
          throw new Error(
            `headless-simple: assistant bubble mounted but stayed empty for 5s — agent did not stream a reply`,
          );
        }
        console.debug("[d5-headless-simple] turn 1 assertions passed", {
          assistantText: text.slice(0, 200),
        });
      },
    },
  ];
}

/** Override the default `/demos/<featureType>` route — same literal
 *  here, but documenting the override keeps the convention consistent
 *  across the script set. */
function preNavigateRoute(): string {
  return "/demos/headless-simple";
}

registerD5Script({
  featureTypes: ["headless-simple"],
  fixtureFile: "headless-simple.json",
  buildTurns,
  preNavigateRoute,
});
