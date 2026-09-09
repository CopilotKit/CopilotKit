/**
 * D5 — gen-ui-interrupt script.
 *
 * Drives `/demos/gen-ui-interrupt`. The agent's `schedule_meeting`
 * tool either calls LangGraph's `interrupt(...)` or is registered as
 * a frontend human-in-the-loop tool. The frontend renders the
 * `<TimePickerCard>` inline, and choosing a slot resumes the run.
 *
 * Genuine assertion: send the pill prompt; assert
 * `[data-testid="time-picker-card"]` mounts; click the first slot
 * (`[data-testid="time-picker-slot"]`); assert the picker visibly
 * resolves and the resumed run finishes. Waiting for both signals,
 * rather than the card's synchronous local picked state alone, proves
 * the tool result completed before the next turn starts.
 */

import { registerD5Script } from "../helpers/d5-registry.js";
import type { D5BuildContext } from "../helpers/d5-registry.js";
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

interface AssistantContinuationState {
  count: number;
  lastText: string;
  pickedTestid: boolean;
  runningNow: boolean | null;
  runStartCount: number;
  lastStoppedAtMs: number;
  runsFinished: number;
  sample: string;
}

/** Read the same assistant-message cascade used by the conversation runner. */
async function readAssistantContinuationState(
  page: Page,
): Promise<AssistantContinuationState> {
  return (await page.evaluate(() => {
    const win = globalThis as unknown as {
      document: {
        querySelector(sel: string): unknown;
        querySelectorAll(
          sel: string,
        ): ArrayLike<{ textContent: string | null }>;
        body: { textContent: string | null };
      };
      __hk_copilotRunning?: {
        runningNow?: boolean | null;
        runStartCount?: number;
        lastStoppedAtMs?: number;
      };
      __hk_runsFinished?: number;
    };
    const selectors = [
      '[data-testid="copilot-assistant-message"]',
      '[role="article"]:not([data-message-role="user"])',
      '[data-message-role="assistant"]',
    ];
    let nodes: ArrayLike<{ textContent: string | null }> = { length: 0 };
    for (const selector of selectors) {
      const found = win.document.querySelectorAll(selector);
      if (found.length > 0) {
        nodes = found;
        break;
      }
    }
    const running = win.__hk_copilotRunning;
    return {
      count: nodes.length,
      lastText:
        nodes.length > 0
          ? (nodes[nodes.length - 1]?.textContent ?? "").toLowerCase()
          : "",
      pickedTestid: !!win.document.querySelector(
        '[data-testid="time-picker-picked"]',
      ),
      runningNow: running?.runningNow ?? null,
      runStartCount: running?.runStartCount ?? 0,
      lastStoppedAtMs: running?.lastStoppedAtMs ?? 0,
      runsFinished: win.__hk_runsFinished ?? 0,
      sample: (win.document.body.textContent ?? "")
        .slice(-200)
        .replace(/\s+/g, " ")
        .trim(),
    };
  })) as AssistantContinuationState;
}

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
    const baseline = await readAssistantContinuationState(page);
    await clickByJs(page, slotSelector);
    // Step 3: require both a visible resolution and an authoritative run
    // completion. The card's local `time-picker-picked` state flips
    // synchronously and only proves that its click handler ran; starting pill
    // 2 at that point races the still-running pill-1 tool result. Some native
    // interrupt backends resolve the existing card without adding another
    // assistant bubble, while frontend-tool backends add a confirmation
    // continuation, so either UI signal is valid once the resumed run ends.
    const deadline = Date.now() + 30_000;
    let lastSnap = "";
    let pickedObserved = false;
    let sseCompletionObservedAt = 0;
    while (Date.now() < deadline) {
      const signal = await readAssistantContinuationState(page);
      const scheduledNarration =
        signal.lastText.includes("booked") ||
        signal.lastText.includes("scheduled") ||
        signal.lastText.includes("confirmed");
      pickedObserved ||= signal.pickedTestid;
      const resolvedUiObserved =
        pickedObserved || (signal.count > baseline.count && scheduledNarration);
      const resumedRunStopped =
        signal.runStartCount > baseline.runStartCount &&
        signal.runningNow === false &&
        signal.lastStoppedAtMs > baseline.lastStoppedAtMs &&
        Date.now() - signal.lastStoppedAtMs >= 500;
      const sseCompletionObserved = signal.runsFinished > baseline.runsFinished;
      if (sseCompletionObserved) {
        sseCompletionObservedAt ||= Date.now();
      } else {
        sseCompletionObservedAt = 0;
      }
      const resumedRunFinished =
        resumedRunStopped ||
        (sseCompletionObservedAt > 0 &&
          Date.now() - sseCompletionObservedAt >= 500);
      if (resolvedUiObserved && resumedRunFinished) {
        return;
      }
      lastSnap = signal.sample;
      await new Promise<void>((r) => setTimeout(r, 250));
    }
    throw new Error(
      `${tag}: post-pick resolution never settled within 30s — expected the picked state or a new booked/scheduled/confirmed assistant bubble plus either a stopped run lifecycle or a new RUN_FINISHED event after the slot response (pickedObserved=${pickedObserved}). Recent body tail: ${JSON.stringify(lastSnap.slice(-200))}`,
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
