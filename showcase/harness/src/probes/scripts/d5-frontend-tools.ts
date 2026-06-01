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

import { registerD5Script } from "../helpers/d5-registry.js";
import type { D5BuildContext } from "../helpers/d5-registry.js";
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

/** Per-pill hint families. Color-name keywords cover wording drift
 *  when the response narrates the gradient ("a sunset orange…") while
 *  full 6-digit hex codes pin the exact fixture output for the
 *  hex-only case (the deterministic d5 fixtures emit pure hex with
 *  no narration, e.g. `linear-gradient(135deg, #ff7e5f 0%, #feb47b
 *  50%, #ff6b6b 100%)`).
 *
 *  IMPORTANT: never use naked hex prefixes like `"#0"` or `"#ff"`.
 *  Short prefixes accidentally cross-match across families (e.g.
 *  cosmic's `#1e3a8a` matches a hypothetical forest prefix `"#1"`),
 *  letting a regression that returns the same gradient for every pill
 *  silently pass. The 6-digit hex codes here are the literal values
 *  from the corresponding fixture pill — adding/removing a fixture
 *  color requires updating the matching family entry in lock-step. */
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
    "#ff7e5f",
    "#feb47b",
    "#ff6b6b",
  ],
  forest: [
    "forest",
    "green",
    "emerald",
    "lime",
    "olive",
    "teal",
    "#0a3d2e",
    "#166534",
    "#059669",
  ],
  cosmic: [
    "cosmic",
    "space",
    "navy",
    "magenta",
    "purple",
    "violet",
    "indigo",
    "fuchsia",
    "#1e3a8a",
    "#6b21a8",
    "#9333ea",
  ],
} as const;

/** Per-pill RGB-channel-dominance test for hex codes parsed out of the
 *  gradient. The substring hint list above pins the fixture/aimock
 *  output deterministically; this dominance check is the fallback for
 *  real-LLM nondeterminism, where the model emits any chromatic-family
 *  hex (e.g. forest as `#005f00 / #4caf50`) that the fixed substring
 *  list can't enumerate. A green hex always satisfies G > R AND G > B
 *  regardless of which exact green; sunset/cosmic mirror that on R/B.
 *
 *  The check requires the channel separation to clear MIN_DELTA so a
 *  near-grey color like `#777` (R≈G≈B) doesn't accidentally satisfy
 *  every family. MIN_VALUE filters out near-black so a single-channel
 *  black-ish swatch (e.g. `#020000`) doesn't pass as red.
 */
const MIN_DOMINANCE_DELTA = 24;
const MIN_DOMINANT_VALUE = 64;
const PILL_HEX_DOMINANCE: Record<
  string,
  (rgb: { r: number; g: number; b: number }) => boolean
> = {
  sunset: ({ r, g, b }) =>
    r >= MIN_DOMINANT_VALUE &&
    r - g >= MIN_DOMINANCE_DELTA &&
    r - b >= MIN_DOMINANCE_DELTA,
  forest: ({ r, g, b }) =>
    g >= MIN_DOMINANT_VALUE &&
    g - r >= MIN_DOMINANCE_DELTA &&
    g - b >= MIN_DOMINANCE_DELTA,
  // Cosmic accepts navy (B dominant) AND purple/magenta (B and R both
  // beat G — the `#9333ea` / `#6b21a8` family) — both are valid
  // "cosmic" outputs in the wild.
  cosmic: ({ r, g, b }) => {
    const navy = b >= MIN_DOMINANT_VALUE && b - g >= MIN_DOMINANCE_DELTA;
    const purple =
      b >= MIN_DOMINANT_VALUE &&
      r >= MIN_DOMINANT_VALUE &&
      b - g >= MIN_DOMINANCE_DELTA &&
      r - g >= MIN_DOMINANCE_DELTA;
    return navy || purple;
  },
};

/** Extract every 6-digit hex code from a CSS string and return them as
 *  RGB triples. 3-digit shorthand (`#0f0`) is intentionally not
 *  expanded — every gradient the demo emits uses 6-digit codes. */
function parseHexes(css: string): { r: number; g: number; b: number }[] {
  const matches = css.match(/#([0-9a-f]{6})/gi) ?? [];
  return matches.map((hex) => {
    const v = hex.slice(1);
    return {
      r: parseInt(v.slice(0, 2), 16),
      g: parseInt(v.slice(2, 4), 16),
      b: parseInt(v.slice(4, 6), 16),
    };
  });
}

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
    const wordOrFixtureHexMatch = hints.some((h) => lower.includes(h));
    const dominance = PILL_HEX_DOMINANCE[pillTag];
    const hexes = parseHexes(next);
    const dominanceMatch =
      dominance !== undefined && hexes.some((rgb) => dominance(rgb));
    if (!wordOrFixtureHexMatch && !dominanceMatch) {
      throw new Error(
        `frontend-tools-${pillTag}: background "${next.slice(0, 200)}" does not contain any expected ${pillTag} hint (words/fixture-hex: ${hints.join(", ")}; no parsed hex satisfied ${pillTag} channel-dominance either)`,
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
