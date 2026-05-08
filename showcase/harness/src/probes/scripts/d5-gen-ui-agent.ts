/**
 * D5 — gen-ui-agent script.
 *
 * Drives `/demos/gen-ui-agent`, where the deep agent emits a custom
 * `set_steps` tool to mutate its own state schema, and the frontend
 * subscribes via `useAgent` and renders an
 * `[data-testid="agent-state-card"]` with one
 * `[data-testid="agent-step"]` per step in `state.steps`.
 *
 * Genuine assertion: send each suggestion-pill prompt; after settle,
 * assert the state card mounted with ≥ 2 step rows. Three pills are
 * exercised sequentially in one probe; per-pill aimock fixtures
 * produce different step content so a regression that returns the
 * same canned step list for every pill (e.g. a hard-coded tool reply
 * not keyed on the user prompt) turns the probe red.
 *
 * Pill prompts are read from `gen-ui-agent/suggestions.ts` so the
 * prompts in this probe stay in sync with the demo's pill set.
 */

import {
  registerD5Script,
  type D5BuildContext,
} from "../helpers/d5-registry.js";
import type { ConversationTurn, Page } from "../helpers/conversation-runner.js";
import { FIRST_SIGNAL_TIMEOUT_MS, waitForTestId } from "./_genuine-shared.js";

/** Pill prompts MUST mirror `gen-ui-agent/suggestions.ts`. */
export const GEN_UI_AGENT_PILLS = [
  {
    tag: "product-launch",
    prompt: "Plan a product launch for a new mobile app.",
  },
  {
    tag: "team-offsite",
    prompt: "Organize a three-day engineering team offsite.",
  },
  {
    tag: "competitor-research",
    prompt:
      "Research our top competitor and summarize their strengths and weaknesses.",
  },
] as const;

/** Read the count of `[data-testid="agent-step"]` rows currently in
 *  the DOM, plus the joined step text for per-pill content
 *  fingerprinting. */
async function readAgentStepState(page: Page): Promise<{
  stepCount: number;
  stepText: string;
}> {
  return (await page.evaluate(() => {
    const win = globalThis as unknown as {
      document: {
        querySelectorAll(
          sel: string,
        ): ArrayLike<{ textContent: string | null }>;
      };
    };
    const nodes = win.document.querySelectorAll('[data-testid="agent-step"]');
    let acc = "";
    for (let i = 0; i < nodes.length; i++) {
      acc += " " + (nodes[i]!.textContent ?? "");
    }
    return { stepCount: nodes.length, stepText: acc };
  })) as { stepCount: number; stepText: string };
}

/** Build a per-pill assertion. `seenStepTextsRef` accumulates the
 *  observed step-text fingerprint across pills — a regression where
 *  every pill produces the SAME steps would fail at the second pill
 *  because `stepText` would equal a previous entry.
 *
 *  Note on the swap-not-accumulate model: the backend's `set_steps`
 *  reducer is `last-write-wins` (see `gen_ui_agent.py`), so each pill
 *  REPLACES `state.steps` rather than appending. The DOM mirrors
 *  state, so step-row count after pill N reflects ONLY pill N's
 *  steps — earlier pills' rows unmount. An earlier "delta vs.
 *  pre-pill baseline ≥ 2" check assumed accumulation and failed at
 *  pill 2+ even when the new steps rendered correctly.
 *
 *  Primary signal: ≥ 2 step rows visible after the pill settles. The
 *  fingerprint deduplication keeps catching a fixture that returns
 *  identical content regardless of prompt — that probe still works
 *  under the swap model, since the textContent of the visible rows
 *  IS the per-pill content.
 */
export function buildAgentStateAssertion(
  pillTag: string,
  seenStepTextsRef: { values: string[] },
): (page: Page) => Promise<void> {
  return async (page: Page): Promise<void> => {
    await waitForTestId(
      page,
      "agent-state-card",
      FIRST_SIGNAL_TIMEOUT_MS,
      `gen-ui-agent-${pillTag}`,
    );
    // Wait briefly for the swap to settle. We need ≥ 2 step rows
    // visible, AND we need the visible textContent to differ from
    // any earlier pill (fingerprint dedup).
    const deadline = Date.now() + 15_000;
    let last = { stepCount: 0, stepText: "" };
    while (Date.now() < deadline) {
      last = await readAgentStepState(page);
      if (last.stepCount >= 2) {
        const fingerprint = last.stepText.trim().toLowerCase();
        if (
          seenStepTextsRef.values.length > 0 &&
          seenStepTextsRef.values.includes(fingerprint)
        ) {
          // Same content as earlier pill — wait for the swap to
          // finish landing. (Brief window where the DOM still
          // shows the previous pill's rows.)
          await new Promise((r) => setTimeout(r, 300));
          continue;
        }
        // Stable, ≥ 2 rows, content differs from earlier pills.
        seenStepTextsRef.values.push(fingerprint);
        return;
      }
      await new Promise((r) => setTimeout(r, 300));
    }
    if (last.stepCount < 2) {
      throw new Error(
        `gen-ui-agent-${pillTag}: expected ≥ 2 [data-testid="agent-step"] rows ` +
          `(observed=${last.stepCount}) within 15s — pill set_steps tool call may not have streamed state`,
      );
    }
    // Reached deadline with enough rows but content kept duplicating
    // an earlier pill — fixture is not differentiating by prompt.
    throw new Error(
      `gen-ui-agent-${pillTag}: step content duplicates an earlier pill — fixture is not differentiating by prompt`,
    );
  };
}

export function buildTurns(_ctx: D5BuildContext): ConversationTurn[] {
  const seenStepTextsRef = { values: [] as string[] };
  return GEN_UI_AGENT_PILLS.map(({ tag, prompt }) => ({
    input: prompt,
    assertions: buildAgentStateAssertion(tag, seenStepTextsRef),
    responseTimeoutMs: 60_000,
  }));
}

registerD5Script({
  featureTypes: ["gen-ui-agent"],
  fixtureFile: "gen-ui-agent.json",
  buildTurns,
});
