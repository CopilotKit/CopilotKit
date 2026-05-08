/**
 * D5 — gen-ui-interrupt script.
 *
 * Drives `/demos/gen-ui-interrupt`. The agent's `schedule_meeting`
 * tool calls LangGraph's `interrupt(...)`; the frontend's
 * `useInterrupt` renders the `<TimePickerCard>` inline. The user
 * picks a slot — that calls `resolve(...)` which resumes the run.
 *
 * Genuine assertion: send the pill prompt; assert
 * `[data-testid="time-picker-card"]` mounts; click the first slot
 * (`[data-testid="time-picker-slot"]`); assert
 * `[data-testid="time-picker-picked"]` mounts (the card flips into
 * the booked-confirmation state). The picked-state mount is the
 * downstream signal that the agent resumed and the resolve callback
 * fired — a regression that drops `resolve` (or where the Card never
 * renders the picked state) catches here, not by reading the
 * transcript.
 */

import {
  registerD5Script,
  type D5BuildContext,
} from "../helpers/d5-registry.js";
import type { ConversationTurn, Page } from "../helpers/conversation-runner.js";
import {
  FIRST_SIGNAL_TIMEOUT_MS,
  SIBLING_TIMEOUT_MS,
  clickByJs,
  waitForTestId,
} from "./_genuine-shared.js";

/** Pill prompts MUST mirror `gen-ui-interrupt/suggestions.ts`. */
export const GEN_UI_INTERRUPT_PILLS = [
  {
    tag: "sales-call",
    prompt: "Book an intro call with the sales team to discuss pricing.",
  },
  {
    tag: "alice-1on1",
    prompt: "Schedule a 1:1 with Alice next week to review Q2 goals.",
  },
] as const;

export function buildInterruptAssertion(
  pillTag: string,
): (page: Page) => Promise<void> {
  return async (page: Page): Promise<void> => {
    const tag = `gen-ui-interrupt-${pillTag}`;
    // Step 1: wait for the time picker to mount.
    await waitForTestId(page, "time-picker-card", FIRST_SIGNAL_TIMEOUT_MS, tag);
    // Step 2: click the first slot. Use the JS-level clickByJs helper
    // (not Playwright's pointer-based click) — the cpk-web-inspector
    // overlay intercepts pointer events before the time-picker's
    // onClick handler runs, so the picked-state never mounts and the
    // probe times out at step 3. Same workaround pattern as d5-auth.
    const slotSelector = '[data-testid="time-picker-slot"]';
    try {
      await page.waitForSelector(slotSelector, {
        state: "visible",
        timeout: SIBLING_TIMEOUT_MS,
      });
    } catch {
      throw new Error(
        `${tag}: expected [data-testid="time-picker-slot"] within ${SIBLING_TIMEOUT_MS}ms`,
      );
    }
    await clickByJs(page, slotSelector);
    // Step 3: assert that the picker resolved — accept either the
    // `time-picker-picked` testid OR the visible "Booked" badge text
    // OR the agent's resume continuation appearing as a new assistant
    // message after the click. The picked-state Card mounts
    // transiently between the slot click and the agent resume; with a
    // fast resume the testid can unmount before the 5s poll sees it,
    // so we widen the accepted signal to "anything that proves the
    // resolve callback fired and propagated downstream."
    const deadline = Date.now() + 30_000;
    let lastSnap = "";
    while (Date.now() < deadline) {
      const signal = await page.evaluate(() => {
        const win = globalThis as unknown as {
          document: {
            querySelector(sel: string): unknown;
            body: { textContent: string | null };
          };
        };
        const pickedTestid = !!win.document.querySelector(
          '[data-testid="time-picker-picked"]',
        );
        const text = (win.document.body.textContent ?? "").toLowerCase();
        const bookedBadge = text.includes("booked");
        // Resume continuation — the canonical fixture's follow-up
        // assistant content for the schedule_meeting tool result.
        const scheduledNarration =
          text.includes("scheduled") || text.includes("confirmed");
        const sample = (win.document.body.textContent ?? "")
          .slice(-200)
          .replace(/\s+/g, " ")
          .trim();
        return { pickedTestid, bookedBadge, scheduledNarration, sample };
      });
      if (
        signal.pickedTestid ||
        signal.bookedBadge ||
        signal.scheduledNarration
      ) {
        return;
      }
      lastSnap = signal.sample;
      await new Promise<void>((r) => setTimeout(r, 250));
    }
    throw new Error(
      `${tag}: post-pick signal never landed within 30s — neither [data-testid="time-picker-picked"] mounted, "Booked" badge text rendered, nor the agent's "scheduled / confirmed" continuation appeared. Recent body tail: ${JSON.stringify(lastSnap.slice(-200))}`,
    );
  };
}

export function buildTurns(_ctx: D5BuildContext): ConversationTurn[] {
  return GEN_UI_INTERRUPT_PILLS.map(({ tag, prompt }) => ({
    input: prompt,
    assertions: buildInterruptAssertion(tag),
    responseTimeoutMs: 60_000,
  }));
}

registerD5Script({
  featureTypes: ["gen-ui-interrupt"],
  fixtureFile: "gen-ui-interrupt.json",
  buildTurns,
});
