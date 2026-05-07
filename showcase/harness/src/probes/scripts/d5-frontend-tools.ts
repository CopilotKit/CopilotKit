/**
 * D5 — frontend-tools script.
 *
 * Drives `/demos/frontend-tools` through three sequential per-pill
 * turns (Sunset / Forest / Cosmic). After each pill prompt we inspect
 * the live `<div data-testid="frontend-tools-background">` style
 * attribute and assert the rendered background is the pill's specific
 * gradient family — not just "changed off default".
 *
 * Why three turns in one probe (and not three split probes the way
 * `beautiful-chat-*` are split): the `change_background` frontend tool
 * is stateless — every pill click overwrites the same React state with
 * a fresh CSS string. There is no "first useComponent wins" quirk
 * here, so a single browser launch can drive all three pills
 * sequentially.
 *
 * Background-mutation detection is the load-bearing assertion: a
 * regression where the agent emits the same gradient for every pill
 * (e.g. fixture key drift, or `change_background` losing the variant
 * argument) would silently keep "transcript mentions theme" green —
 * but it cannot keep three distinct gradients green. After each pill
 * we capture the attribute, then assert (a) the next pill produced a
 * substantively different gradient and (b) the gradient mentions the
 * keyword family that pill is supposed to evoke (sunset = warm
 * orange/red palette; forest = green; cosmic = purple/magenta/navy).
 *
 * Pill prompts are sent via the conversation runner's normal
 * `fillAndVerifySend` path (typing into the textarea + pressing
 * Enter), not by clicking the suggestion pill UI. The pill UI dispatch
 * path and the textarea-Enter dispatch path both call the same
 * `runAgent`; using the textarea avoids the suggestion-pill auto-
 * dismiss timing race that beautiful-chat probes documented.
 */

import {
  registerD5Script,
  type D5BuildContext,
} from "../helpers/d5-registry.js";
import type { ConversationTurn, Page } from "../helpers/conversation-runner.js";
import {
  FIRST_SIGNAL_TIMEOUT_MS,
  SIBLING_TIMEOUT_MS,
  waitForTestId,
} from "./_genuine-shared.js";

const BG_TESTID = "frontend-tools-background";

/** Pill prompts MUST match `frontend-tools/suggestions.ts` so the
 *  harness `aimock-fixture-coverage` invariant continues to pass. */
export const FRONTEND_TOOL_PILLS = [
  {
    tag: "sunset",
    prompt: "Make the background a sunset gradient.",
  },
  {
    tag: "forest",
    prompt: "Switch to a deep green forest gradient.",
  },
  {
    tag: "cosmic",
    prompt: "Make it a navy → magenta cosmic gradient.",
  },
] as const;

/** Per-pill keyword families. The agent's gradient string is free-form
 *  CSS, but a real LLM (and our fixtures) consistently mention at least
 *  ONE color name from each family. Matching against ANY token in the
 *  family is robust to wording drift while still catching a regression
 *  that returns the same gradient for every pill.
 *
 *  IMPORTANT: keep these to color-name keywords ONLY (no naked hex
 *  prefixes like `"#0"` or `"#ff"`). Naked hex prefixes accidentally
 *  cross-match across families (e.g. cosmic's `#1e3a8a` matches a
 *  hypothetical forest prefix `"#1"`), letting a regression that
 *  returns the same gradient for every pill silently pass. If a hex
 *  signal is ever required, use a FULL 6-digit code drawn from the
 *  actual fixture rather than a 1-2 character prefix. */
export const PILL_GRADIENT_HINTS: Record<string, readonly string[]> = {
  sunset: [
    "sunset",
    "orange",
    "red",
    "rose",
    "pink",
    "amber",
    "coral",
    "peach",
  ],
  forest: ["forest", "green", "emerald", "lime", "olive", "teal"],
  cosmic: [
    "cosmic",
    "space",
    "navy",
    "magenta",
    "purple",
    "violet",
    "indigo",
    "fuchsia",
  ],
} as const;

/** Read the live background CSS off the testid'd container. */
async function readBackgroundCss(page: Page): Promise<string> {
  return (await page.evaluate(() => {
    const win = globalThis as unknown as {
      document: {
        querySelector(sel: string): {
          getAttribute(name: string): string | null;
        } | null;
      };
    };
    const el = win.document.querySelector(
      '[data-testid="frontend-tools-background"]',
    );
    if (!el) return "";
    return el.getAttribute("data-background-value") ?? "";
  })) as string;
}

/** Wait for the background CSS to differ from the supplied baseline
 *  (i.e. the value present BEFORE the click). Times out after
 *  FIRST_SIGNAL_TIMEOUT_MS. */
async function waitForBackgroundChange(
  page: Page,
  baseline: string,
  pillTag: string,
): Promise<string> {
  const deadline = Date.now() + FIRST_SIGNAL_TIMEOUT_MS;
  let last = baseline;
  while (Date.now() < deadline) {
    last = await readBackgroundCss(page);
    if (last !== baseline && last.length > 0) return last;
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(
    `frontend-tools-${pillTag}: background did not change off baseline within ${FIRST_SIGNAL_TIMEOUT_MS}ms (still "${baseline.slice(0, 80)}")`,
  );
}

/** Build a per-pill assertion. The first turn baselines off the
 *  DEFAULT_BACKGROUND ("#4f46e5"); subsequent turns baseline off the
 *  PREVIOUS pill's gradient — that way a regression returning the same
 *  gradient for every pill turns the probe red on turn 2. */
export function buildPillAssertion(
  pillTag: keyof typeof PILL_GRADIENT_HINTS,
  baselineRef: { current: string },
): (page: Page) => Promise<void> {
  const hints = PILL_GRADIENT_HINTS[pillTag] ?? [];
  return async (page: Page): Promise<void> => {
    await waitForTestId(
      page,
      BG_TESTID,
      SIBLING_TIMEOUT_MS,
      `frontend-tools-${pillTag}`,
    );
    const next = await waitForBackgroundChange(
      page,
      baselineRef.current,
      pillTag,
    );
    const lower = next.toLowerCase();
    const matched = hints.some((h) => lower.includes(h));
    if (!matched) {
      throw new Error(
        `frontend-tools-${pillTag}: background "${next.slice(0, 200)}" does not contain any expected ${pillTag} hint (any of ${hints.join(", ")})`,
      );
    }
    baselineRef.current = next;
  };
}

export function buildTurns(_ctx: D5BuildContext): ConversationTurn[] {
  // Mutable holder threaded through each turn's assertion so turn N+1
  // baselines off turn N's observed gradient. Initial value matches
  // DEFAULT_BACKGROUND in `frontend-tools/background.tsx`.
  const baselineRef = { current: "#4f46e5" };
  return FRONTEND_TOOL_PILLS.map(({ tag, prompt }) => ({
    input: prompt,
    assertions: buildPillAssertion(
      tag as keyof typeof PILL_GRADIENT_HINTS,
      baselineRef,
    ),
    responseTimeoutMs: 60_000,
  }));
}

registerD5Script({
  featureTypes: ["frontend-tools"],
  fixtureFile: "frontend-tools.json",
  buildTurns,
});
