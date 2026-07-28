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
 * assert the state card mounted with ≥ 2 NON-EMPTY step rows AND that
 * the rendered step text contains that pill's EXPECTED CONTENT MARKERS
 * (distinctive, stable tokens drawn from the pill's step titles).
 * Three pills are exercised sequentially in one probe, each with a
 * different set of markers, so a regression that returns the same
 * canned step list for every pill (e.g. a hard-coded tool reply not
 * keyed on the user prompt) renders the WRONG pill's content and turns
 * the probe red — as does a stale non-adjacent render (pill 3 still
 * showing pill 1's content) or empty/whitespace-only step rows.
 *
 * Pill prompts and their expected markers are HARDCODED here (they are
 * NOT read from the demo's `suggestions.ts` — that file is a separate
 * copy in the frontend). If the demo's pill set changes, update
 * `GEN_UI_AGENT_PILLS` here to match. The expected markers are derived
 * from the step titles in `showcase/harness/fixtures/d5/gen-ui-agent.json`.
 */

import {
  registerD5Script,
  type D5BuildContext,
} from "../helpers/d5-registry.js";
import type { ConversationTurn, Page } from "../helpers/conversation-runner.js";
import { FIRST_SIGNAL_TIMEOUT_MS, waitForTestId } from "./_genuine-shared.js";

/**
 * Pill prompts MUST mirror the demo's hardcoded suggestion pills.
 *
 * `expectedMarkers` are low-brittleness, case-insensitive substrings
 * that appear robustly in that pill's step titles (see the fixture
 * `showcase/harness/fixtures/d5/gen-ui-agent.json`):
 *   - product-launch: titles mention "launch" and "marketing".
 *   - team-offsite:    titles mention "venue" and "agenda".
 *   - competitor-research: titles mention "competitor" and "weakness".
 * These are deliberately partial tokens (not full-text match) so the
 * assertion is robust to live-LLM (--direct) nondeterminism while still
 * proving the RIGHT pill's content rendered.
 */
export const GEN_UI_AGENT_PILLS = [
  {
    tag: "product-launch",
    prompt: "Plan a product launch for a new mobile app.",
    expectedMarkers: ["launch", "marketing"],
  },
  {
    tag: "team-offsite",
    prompt: "Organize a three-day engineering team offsite.",
    expectedMarkers: ["venue", "agenda"],
  },
  {
    tag: "competitor-research",
    prompt:
      "Research our top competitor and summarize their strengths and weaknesses.",
    expectedMarkers: ["competitor", "weakness"],
  },
] as const;

/** Read the per-row text of every `[data-testid="agent-step"]` node
 *  currently in the DOM. Returns the trimmed text of each row so the
 *  caller can reject empty/whitespace-only rows and match content
 *  markers. */
async function readAgentStepRows(page: Page): Promise<string[]> {
  return (await page.evaluate(() => {
    const win = globalThis as unknown as {
      document: {
        querySelectorAll(
          sel: string,
        ): ArrayLike<{ textContent: string | null }>;
      };
    };
    const nodes = win.document.querySelectorAll('[data-testid="agent-step"]');
    const rows: string[] = [];
    for (let i = 0; i < nodes.length; i++) {
      rows.push((nodes[i]!.textContent ?? "").trim());
    }
    return rows;
  })) as string[];
}

/** Build a per-pill assertion driven by EXPECTED CONTENT.
 *
 *  The state card is populated asynchronously: after a pill click the
 *  `set_steps` tool streams state over a short swap window, during which
 *  the DOM may still show the previous pill's rows before this pill's
 *  content lands. We therefore POLL until the correct content appears
 *  (exercising the swap-window wait loop), then assert:
 *
 *    1. ≥ 2 NON-EMPTY step rows (a row that trims to empty does not
 *       count — that rejects a card that rendered blank/placeholder
 *       rows).
 *    2. The joined step text contains ALL of this pill's expected
 *       markers (case-insensitive substring).
 *
 *  This is robust to live-LLM nondeterminism (it checks the RIGHT
 *  content rendered, not exact text) WITHOUT false-greening:
 *    - identical-across-pills canned steps → wrong markers → RED;
 *    - stale non-adjacent content (pill 3 showing pill 1) → wrong
 *      markers → RED;
 *    - empty/whitespace rows → fewer than 2 non-empty rows → RED.
 *
 *  `seenStepTextsRef` is retained for diagnostic accumulation only; it
 *  no longer gates acceptance (the earlier cross-pill-difference
 *  heuristic was fragile and could false-fail on coincidental live-LLM
 *  content collisions). Content-marker matching replaces it.
 */
export function buildAgentStateAssertion(
  pillTag: string,
  expectedMarkers: readonly string[],
  seenStepTextsRef: { values: string[] },
): (page: Page) => Promise<void> {
  return async (page: Page): Promise<void> => {
    await waitForTestId(
      page,
      "agent-state-card",
      FIRST_SIGNAL_TIMEOUT_MS,
      `gen-ui-agent-${pillTag}`,
    );

    const markers = expectedMarkers.map((m) => m.toLowerCase());
    const deadline = Date.now() + 15_000;
    let rows: string[] = [];
    let nonEmpty: string[] = [];
    let joined = "";
    let missing: string[] = markers.slice();

    while (Date.now() < deadline) {
      rows = await readAgentStepRows(page);
      nonEmpty = rows.filter((r) => r.length > 0);
      joined = nonEmpty.join(" ").toLowerCase();
      missing = markers.filter((m) => !joined.includes(m));
      if (nonEmpty.length >= 2 && missing.length === 0) {
        // Correct pill content has landed with ≥ 2 non-empty rows.
        seenStepTextsRef.values.push(joined);
        return;
      }
      // Either the swap has not landed yet (still showing the prior
      // pill / empty rows) or content is missing markers — keep polling
      // until this pill's expected content appears.
      await new Promise((r) => setTimeout(r, 300));
    }

    if (nonEmpty.length < 2) {
      throw new Error(
        `gen-ui-agent-${pillTag}: expected ≥ 2 non-empty ` +
          `[data-testid="agent-step"] rows ` +
          `(observed ${nonEmpty.length} non-empty of ${rows.length} total) ` +
          `within 15s — pill set_steps tool call may not have streamed state`,
      );
    }
    throw new Error(
      `gen-ui-agent-${pillTag}: rendered ${nonEmpty.length} step rows but ` +
        `their content is missing expected marker(s) [${missing.join(", ")}] ` +
        `within 15s — the card shows the wrong pill's content ` +
        `(stale/duplicated steps) rather than this pill's steps. ` +
        `Observed: ${JSON.stringify(nonEmpty)}`,
    );
  };
}

export function buildTurns(_ctx: D5BuildContext): ConversationTurn[] {
  const seenStepTextsRef = { values: [] as string[] };
  return GEN_UI_AGENT_PILLS.map(({ tag, prompt, expectedMarkers }) => ({
    input: prompt,
    assertions: buildAgentStateAssertion(
      tag,
      expectedMarkers,
      seenStepTextsRef,
    ),
    responseTimeoutMs: 60_000,
  }));
}

registerD5Script({
  featureTypes: ["gen-ui-agent"],
  fixtureFile: "gen-ui-agent.json",
  buildTurns,
});
