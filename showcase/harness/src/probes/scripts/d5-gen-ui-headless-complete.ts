/**
 * D5 — gen-UI (headless-complete) script.
 *
 * Probes the showcase's `/demos/headless-complete` page — a hand-rolled
 * chat surface (no `<CopilotChat />`) that exercises the full
 * generative-UI composition: per-tool renderers (WeatherCard, StockCard,
 * HighlightNote), an agent-emitted chart card, and a markdown-rendered
 * text fallback.
 *
 * The page renders four suggestion chips above the composer via
 * `SuggestionBar` (powered by `useConfigureSuggestions`). Each chip's
 * visible label is the suggestion's `title`; clicking it dispatches the
 * suggestion's `message` to the agent. The chip set + messages live in
 * `headless-complete/hooks/use-headless-suggestions.ts`:
 *
 *   1. "Weather"        → "What's the weather in Tokyo?"      → WeatherCard
 *   2. "Stock price"    → "What's the price of AAPL right now?" → StockCard
 *   3. "Highlight a note" → "Highlight this note for me: 'ship the demo on Friday'."
 *                                                              → HighlightNote
 *   4. "Revenue chart"  → "Show me a chart of revenue over the last six months."
 *                                                              → ChartCard
 *
 * Each turn asserts the matching tool card mounted (per-card testid)
 * and a distinguishing text fragment landed (city / ticker / phrase).
 *
 * All four turns use `preFill` to click the chip — the runner's normal
 * fill+press is a no-op because the SuggestionBar's `onPick` already
 * submitted the message and the demo's send guards empty input.
 */

import { registerD5Script } from "../helpers/d5-registry.js";
import type { D5BuildContext } from "../helpers/d5-registry.js";
import type { ConversationTurn, Page } from "../helpers/conversation-runner.js";

interface TurnExpectation {
  /** Tag for diagnostics; matches the suggestion's `title`. */
  tag: string;
  /** Message to send — same string the demo's chips would submit
   *  (`useHeadlessSuggestions` `.message` for the SuggestionBar, and
   *  the verbatim `EmptyState` SAMPLE for first paint). */
  prompt: string;
  /** Selector that must mount once the agent's tool result lands. */
  cardSelector: string;
  /** Lowercase substrings that must appear in the messages region. */
  textTokens: readonly string[];
  /** Per-turn budget — agent + tool + render. */
  responseTimeoutMs: number;
}

/** The demo has TWO chip surfaces with diverging aria-label shapes:
 *  - EmptyState (first paint): `aria-label="Try suggestion: <message>"`,
 *    visible text = message
 *  - SuggestionBar (post-first-message): `aria-label="Suggestion: <title>"`,
 *    visible text = title
 *  The chip surface visible at any given turn depends on whether the
 *  chat has messages yet, which is timing-dependent. Skipping the chip
 *  click and typing into the textarea avoids the surface-divergence
 *  entirely — both chip clicks and textarea-Enter submit the same
 *  message string, so the fixture matcher catches either path. */
const TURN_EXPECTATIONS: readonly TurnExpectation[] = [
  {
    tag: "weather",
    prompt: "What's the weather in Tokyo?",
    cardSelector: '[data-testid="headless-weather-card"]',
    textTokens: ["tokyo"],
    responseTimeoutMs: 60_000,
  },
  {
    tag: "stock",
    prompt: "What's the price of AAPL right now?",
    cardSelector: '[data-testid="headless-stock-card"]',
    textTokens: ["aapl"],
    responseTimeoutMs: 60_000,
  },
  {
    tag: "highlight",
    prompt: "Highlight this note for me: 'ship the demo on Friday'.",
    cardSelector: '[data-testid="headless-highlight-card"]',
    textTokens: ["ship the demo"],
    responseTimeoutMs: 60_000,
  },
  {
    tag: "revenue",
    prompt: "Show me a chart of revenue over the last six months.",
    cardSelector: '[data-testid="headless-revenue-chart"]',
    // The chart card's eyebrow / heading is just "Revenue", not the
    // chip text — the chart's own data labels are the only stable
    // fragment we can pin without depending on the agent's narration.
    textTokens: ["revenue"],
    responseTimeoutMs: 60_000,
  },
];

/** Read all assistant-message bubbles' textContent and concatenate to
 *  lowercase. Captures BOTH the markdown prose AND the rendered tool
 *  card text since both render inside the bubble. */
async function readAllAssistantText(page: Page): Promise<string> {
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
    let combined = "";
    for (let i = 0; i < nodes.length; i++) {
      combined += " " + (nodes[i]!.textContent ?? "");
    }
    return combined.toLowerCase();
  });
}

function assertContainsAll(
  text: string,
  tokens: readonly string[],
  context: string,
): void {
  const missing = tokens.filter((t) => !text.includes(t.toLowerCase()));
  if (missing.length > 0) {
    throw new Error(
      `${context}: assistant text missing tokens [${missing.join(", ")}]; got (truncated): ${text.slice(0, 300)}`,
    );
  }
}

export function buildTurns(_ctx: D5BuildContext): ConversationTurn[] {
  return TURN_EXPECTATIONS.map((exp, idx) => ({
    input: exp.prompt,
    responseTimeoutMs: exp.responseTimeoutMs,
    assertions: async (page) => {
      console.debug(
        `[d5-gen-ui-headless-complete] turn ${idx + 1}: ${exp.tag}`,
      );
      // Wait for the per-card testid before reading text — the runner's
      // settle plateau gates on assistant-message count growing, but
      // the tool card mounts in a separate React update once the tool
      // result lands. A short follow-up wait avoids racing the read.
      try {
        await page.waitForSelector(exp.cardSelector, {
          state: "visible",
          timeout: 60_000,
        });
      } catch {
        throw new Error(
          `gen-ui-headless-complete ${exp.tag}: expected ${exp.cardSelector} to mount within 60s — tool result may not have landed or the renderer wiring drifted`,
        );
      }
      const text = await readAllAssistantText(page);
      console.debug(`[d5-gen-ui-headless-complete] turn ${idx + 1} text`, {
        text: text.slice(0, 300),
      });
      assertContainsAll(
        text,
        exp.textTokens,
        `gen-ui-headless-complete ${exp.tag}`,
      );
    },
  }));
}

/** Override the default `/demos/<featureType>` route. The hyphenated
 *  feature type would resolve to `/demos/gen-ui-headless-complete`,
 *  which doesn't exist — the actual showcase route is
 *  `/demos/headless-complete`. */
function preNavigateRoute(): string {
  return "/demos/headless-complete";
}

registerD5Script({
  featureTypes: ["gen-ui-headless-complete"],
  fixtureFile: "gen-ui-headless-complete.json",
  buildTurns,
  preNavigateRoute,
});
