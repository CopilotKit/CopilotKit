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
  asGenuinePage,
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
    // Step 2: click the first slot. The runner's structural Page
    // doesn't expose `.click()`; runtime-cast and verify.
    const clickable = asGenuinePage(page, tag);
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
    await clickable.click(slotSelector, { timeout: SIBLING_TIMEOUT_MS });
    // Step 3: assert the picked-confirmation state mounts.
    await waitForTestId(page, "time-picker-picked", SIBLING_TIMEOUT_MS, tag);
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
