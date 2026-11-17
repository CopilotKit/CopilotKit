/**
 * D5 — interrupt-headless script.
 *
 * Drives `/demos/interrupt-headless`. Same backend pause as
 * gen-ui-interrupt: the agent's `schedule_meeting` tool interrupts the run and
 * hands the client its pause-time context. The DIFFERENCE is where the picker
 * goes. Instead of rendering inline in the chat bubble, this demo places the
 * interrupt element in a separate "app surface" pane (left), not in the chat
 * (right), either through `useInterrupt({ renderInChat: false })`, or, on the
 * bridges that surface a pause as a legacy custom event, through a hand-rolled
 * subscribe-and-resume hook.
 *
 * Two-turn flow per chip:
 *   1. Send the chip prompt, the backend pauses, and
 *      `[data-testid="interrupt-headless-popup"]` mounts in the app surface
 *      (NOT in the chat).
 *   2. Click the first slot button, which resolves with
 *      `{chosen_time, chosen_label}`; the run resumes, the popup unmounts back
 *      to `interrupt-headless-empty`, and the assistant confirmation lands in
 *      chat. The pill is done only when the resumed run has also finished, so
 *      the next pill never races it.
 *
 * The "popup unmounts back to empty" + "assistant confirmation" pair is
 * the genuine downstream signal — it proves resolve() fired AND
 * propagated through `runAgent()` AND the agent resumed. A regression
 * that drops the resolve callback (or breaks the resume forwardedProps
 * shape) will be caught here.
 */

import { registerD5Script } from "../helpers/d5-registry.js";
import type { D5BuildContext } from "../helpers/d5-registry.js";
import type { ConversationTurn, Page } from "../helpers/conversation-runner.js";
import {
  FIRST_SIGNAL_TIMEOUT_MS,
  SIBLING_TIMEOUT_MS,
  clickByJs,
  waitForTestId,
  watchResumedRun,
} from "./_genuine-shared.js";

/** Chip prompts MUST mirror `interrupt-headless/page.tsx` lines 54-65
 *  verbatim. Drift here means showcase-aimock falls through to no
 *  fixture → "An internal error occurred" on the demo page. */
export const INTERRUPT_HEADLESS_PILLS = [
  {
    tag: "sales-call",
    prompt: "Book an intro call with the sales team to discuss pricing.",
  },
  {
    tag: "alice-1on1",
    prompt: "Schedule a 1:1 with Alice next week to review Q2 goals.",
  },
] as const;

/**
 * Read, in one page round-trip, whether the pick has visibly resolved and the
 * agent's run lifecycle.
 */
async function readPickState(page: Page) {
  return page.evaluate(() => {
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
    const emptyMounted = !!win.document.querySelector(
      '[data-testid="interrupt-headless-empty"]',
    );
    const popupGone = !win.document.querySelector(
      '[data-testid="interrupt-headless-popup"]',
    );
    // Scoped to assistant bubbles, never the whole page: this demo's own
    // static copy contains "Nothing scheduled yet" and "the confirmed
    // booking", so a body-wide search would be satisfied before the agent
    // narrated anything.
    const selectors = [
      '[data-testid="copilot-assistant-message"]',
      '[role="article"]:not([data-message-role="user"])',
      '[data-message-role="assistant"]',
    ];
    let bubbles: ArrayLike<{ textContent: string | null }> = { length: 0 };
    for (const selector of selectors) {
      const found = win.document.querySelectorAll(selector);
      if (found.length > 0) {
        bubbles = found;
        break;
      }
    }
    let text = "";
    for (let i = 0; i < bubbles.length; i += 1) {
      text += " " + (bubbles[i]?.textContent ?? "");
    }
    text = text.toLowerCase();
    const scheduledNarration =
      text.includes("meeting scheduled") ||
      text.includes("booked") ||
      text.includes("confirmed for");
    const sample = (win.document.body.textContent ?? "")
      .slice(-200)
      .replace(/\s+/g, " ")
      .trim();
    const running = win.__hk_copilotRunning;
    return {
      emptyMounted,
      popupGone,
      scheduledNarration,
      sample,
      runningNow: running?.runningNow ?? null,
      runStartCount: running?.runStartCount ?? 0,
      lastStoppedAtMs: running?.lastStoppedAtMs ?? 0,
      runsFinished: win.__hk_runsFinished ?? 0,
    };
  });
}

/** Build the post-chip assertion that mirrors gen-ui-interrupt's flow
 *  but against this demo's app-surface testids. */
export function buildInterruptHeadlessAssertion(pillTag: string) {
  return async (page: Page) => {
    const tag = `interrupt-headless-${pillTag}`;
    // Step 1: wait for the popup to mount in the app-surface pane.
    await waitForTestId(
      page,
      "interrupt-headless-popup",
      FIRST_SIGNAL_TIMEOUT_MS,
      tag,
    );
    // Step 2: click the FIRST slot button. The slot testid is dynamic
    // (`interrupt-headless-slot-${iso}`), so use a starts-with attribute
    // selector. Use clickByJs (not Playwright's pointer click) to dodge
    // the cpk-web-inspector overlay — same workaround as
    // d5-gen-ui-interrupt and d5-auth.
    const slotSelector = '[data-testid^="interrupt-headless-slot-"]';
    try {
      await page.waitForSelector(slotSelector, {
        state: "visible",
        timeout: SIBLING_TIMEOUT_MS,
      });
    } catch {
      throw new Error(
        `${tag}: expected at least one [data-testid^="interrupt-headless-slot-"] within ${SIBLING_TIMEOUT_MS}ms`,
      );
    }
    const isResumedRunFinished = watchResumedRun(await readPickState(page));
    await clickByJs(page, slotSelector);
    // Step 3: wait until the pick has visibly resolved AND the resumed run
    // has finished. The visible signal is either:
    //   a. `interrupt-headless-empty` mounted (the popup unmounted); OR
    //   b. an assistant continuation IN THE TRANSCRIPT naming the booking.
    // The text search is scoped to the transcript and to phrases the demo's
    // own static copy does not contain, so neither signal can be satisfied by
    // the page merely rendering.
    // The visible signal alone is not enough: a page that clears its picker
    // on RUN_STARTED re-mounts the empty state while the resumed run is still
    // in flight. A pill sent then is lost: its run never reaches the LLM, and
    // the resumed reply never renders.
    const deadline = Date.now() + 30_000;
    let lastSnap = "";
    let resolvedUiObserved = false;
    let resumedRunFinished = false;
    while (Date.now() < deadline) {
      const signal = await readPickState(page);
      resolvedUiObserved =
        signal.emptyMounted || (signal.popupGone && signal.scheduledNarration);
      resumedRunFinished = isResumedRunFinished(signal);
      if (resolvedUiObserved && resumedRunFinished) {
        return;
      }
      lastSnap = signal.sample;
      await new Promise<void>((r) => setTimeout(r, 250));
    }
    throw new Error(
      `${tag}: post-pick resolution never settled within 30s — expected [data-testid="interrupt-headless-empty"] to re-mount or an assistant "scheduled / confirmed / booked" continuation, plus either a stopped run lifecycle or a new RUN_FINISHED event after the slot response (resolvedUiObserved=${resolvedUiObserved}, resumedRunFinished=${resumedRunFinished}). Recent body tail: ${JSON.stringify(lastSnap.slice(-200))}`,
    );
  };
}

export function buildTurns(_ctx: D5BuildContext): ConversationTurn[] {
  return INTERRUPT_HEADLESS_PILLS.map(({ tag, prompt }) => ({
    input: prompt,
    completionSignal: "sse",
    // Same shape as gen-ui-interrupt: the turn ends AT the pause, with the
    // picker mounted in the app surface and no assistant prose on a bridge
    // that emits the tool call before pausing. Settle on the popup mounting
    // instead of text stability; run-finished and new-bubble still apply.
    completeOnMount: { testIds: ["interrupt-headless-popup"] },
    assertions: buildInterruptHeadlessAssertion(tag),
    // Each pill exercises a full interrupt → resolve → resume cycle —
    // bigger budget than agentic-chat's text-only turns. The 60s ceiling
    // covers tool-call → interrupt → frontend popup mount → click →
    // runAgent resume → assistant confirmation.
    responseTimeoutMs: 60_000,
  }));
}

registerD5Script({
  featureTypes: ["interrupt-headless"],
  fixtureFile: "interrupt-headless.json",
  buildTurns,
});
