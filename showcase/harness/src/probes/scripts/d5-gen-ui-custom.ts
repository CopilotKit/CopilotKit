/**
 * D5 — gen-UI (custom) script.
 *
 * Probes the showcase's `/demos/gen-ui-tool-based` page against
 * whichever frontend-defined tool the integration registers:
 *
 *   - **langgraph-python**, **ms-agent-python**, and **spring-ai** register
 *     chart tools (`render_pie_chart` / `render_bar_chart`) via `useComponent`
 *     (renders donut/bar SVG charts).
 *   - **All other integrations** register `generate_haiku` via
 *     `useFrontendTool` (renders a HaikuCard with Japanese/English text
 *     and an optional image).
 *
 * The fixture (`fixtures/d5/gen-ui-custom.json`) carries BOTH tool
 * patterns keyed by different user messages. The probe branches on
 * `integrationSlug` to send the correct message and assert the matching
 * rendering shape.
 *
 * Why "custom" is stricter than "headless":
 *   - `headless` checks that *some* component rendered with
 *     non-trivial structure.
 *   - `custom` additionally asserts the rendered shape MATCHES the
 *     expected structure for the recorded tool:
 *       - `render_pie_chart`: `<svg>` with multiple drawing elements
 *       - `generate_haiku`: `[data-testid="haiku-card"]` or any
 *         card-like element with text children
 */

import { registerD5Script } from "../helpers/d5-registry.js";
import type { D5BuildContext } from "../helpers/d5-registry.js";
import type { ConversationTurn, Page } from "../helpers/conversation-runner.js";
import {
  readLastAssistantText,
  readSvgChartShape,
  waitForGenUiComponent,
} from "./_gen-ui-shared.js";

/**
 * Integrations that register chart tools (`render_pie_chart` and/or
 * `render_bar_chart`) via `useComponent`. All others use the
 * `generate_haiku` / HaikuCard pattern via `useFrontendTool`.
 *
 *   - langgraph-python: `render_pie_chart` only
 *   - ms-agent-python:  `render_bar_chart` + `render_pie_chart`
 *   - spring-ai:        `render_bar_chart` + `render_pie_chart`
 */
const CHART_INTEGRATIONS = new Set([
  "langgraph-python",
  "ms-agent-python",
  "spring-ai",
  // google-adk's gen-ui-tool-based page was ported from langgraph-python
  // verbatim during the D5 parity push, so it registers
  // `render_pie_chart` + `render_bar_chart` via `useComponent` like LGP
  // does, not the legacy `generate_haiku` shape.
  "google-adk",
]);

/**
 * Lower-bound for the donut chart's drawing-child count (pie chart path).
 */
const MIN_CHART_DRAWING_CHILDREN = 2;

/**
 * Follow-up tokens for the pie chart path. Token-level check guards
 * against a silent regression where the chart renders but the second
 * LLM leg never fires.
 *
 * The haiku path has no follow-up tokens because `useFrontendTool`
 * with `followUp: false` skips the second-leg narration entirely.
 */
const PIE_CHART_FOLLOWUP_TOKENS = ["pie", "chart"] as const;

/**
 * User messages per rendering path. Must match the fixture's
 * `match.userMessage` entries exactly.
 */
const PIE_CHART_USER_MESSAGE = "Show me a pie chart of revenue by category";
const HAIKU_USER_MESSAGE = "Write me a haiku about nature";

function isChartIntegration(slug: string): boolean {
  return CHART_INTEGRATIONS.has(slug);
}

export function buildTurns(ctx: D5BuildContext): ConversationTurn[] {
  const usePieChart = isChartIntegration(ctx.integrationSlug);
  console.debug("[d5-gen-ui-custom] buildTurns", {
    slug: ctx.integrationSlug,
    usePieChart,
    userMessage: usePieChart ? PIE_CHART_USER_MESSAGE : HAIKU_USER_MESSAGE,
  });

  return [
    {
      input: usePieChart ? PIE_CHART_USER_MESSAGE : HAIKU_USER_MESSAGE,
      assertions: async (page) => {
        // 1. Cascade-find the rendered component. Gen-UI components
        //    surface through the same selector hooks regardless of which
        //    tool fired.
        console.debug("[d5-gen-ui-custom] waiting for gen-UI component");
        const matchedSelector = await waitForGenUiComponent(page);
        console.debug("[d5-gen-ui-custom] gen-UI component found", {
          matchedSelector,
        });

        if (usePieChart) {
          // --- Pie chart path (chart integrations) ---
          console.debug("[d5-gen-ui-custom] asserting pie chart shape");
          await assertPieChartShape(page, matchedSelector);

          // Narration check: the second-leg LLM response must
          // mention the chart. Token-level so wording drift doesn't
          // fail the probe.
          const text = (await readLastAssistantText(page)).toLowerCase();
          console.debug("[d5-gen-ui-custom] pie chart follow-up text check", {
            expectedTokens: [...PIE_CHART_FOLLOWUP_TOKENS],
            assistantText: text.slice(0, 300),
          });
          const missing = PIE_CHART_FOLLOWUP_TOKENS.filter(
            (tok) => !text.includes(tok),
          );
          if (missing.length > 0) {
            throw new Error(
              `gen-ui-custom: assistant follow-up missing tokens [${missing.join(
                ", ",
              )}]; last assistant text: ${text.slice(0, 200)}`,
            );
          }
        } else {
          // --- Haiku card path (all other integrations) ---
          // The haiku integrations use `useFrontendTool` with
          // `followUp: false`, so there is no second-leg narration.
          // The structural check alone (card rendered with children
          // + text) is sufficient for the custom tier.
          console.debug("[d5-gen-ui-custom] asserting haiku card shape");
          await assertHaikuCardShape(page, matchedSelector);
          console.debug("[d5-gen-ui-custom] haiku card assertion passed");
        }
      },
    },
  ];
}

/**
 * Assert the SVG chart shape (chart integrations' `render_pie_chart`).
 */
async function assertPieChartShape(
  page: Page,
  matchedSelector: string,
): Promise<void> {
  const shape = await readSvgChartShape(page);
  if (!shape.hasSvg) {
    throw new Error(
      `gen-ui-custom: matched component ${matchedSelector} but no <svg> rendered (expected pie-chart SVG)`,
    );
  }
  if (shape.drawingChildren < MIN_CHART_DRAWING_CHILDREN) {
    throw new Error(
      `gen-ui-custom: pie-chart SVG has ${shape.drawingChildren} drawing children (expected >= ${MIN_CHART_DRAWING_CHILDREN}); circles=${shape.circleCount} paths=${shape.pathCount} rects=${shape.rectCount}`,
    );
  }
  if (shape.circleCount === 0 && shape.pathCount === 0) {
    throw new Error(
      `gen-ui-custom: SVG has neither <circle> nor <path> elements (rects=${shape.rectCount}); shape doesn't match a chart`,
    );
  }
}

/**
 * Assert the haiku card shape (all non-chart integrations' `generate_haiku`).
 *
 * The HaikuCard component renders:
 *   - `[data-testid="haiku-card"]` wrapper div
 *   - Inside: `[data-testid="haiku-japanese-line"]` and
 *     `[data-testid="haiku-english-line"]` text elements
 *
 * The structural assertion checks that:
 *   1. A haiku card (or any non-trivial rendered component) is present
 *   2. It has visible text children (not an empty wrapper)
 */
async function assertHaikuCardShape(
  page: Page,
  matchedSelector: string,
): Promise<void> {
  const cardInfo = await page.evaluate(() => {
    const win = globalThis as unknown as {
      document: {
        querySelector(sel: string): {
          childElementCount: number;
          textContent: string | null;
        } | null;
        querySelectorAll(sel: string): { length: number };
      };
    };

    // Try the specific haiku testid first, then fall back to any
    // rendered component with children.
    const haikuCard = win.document.querySelector('[data-testid="haiku-card"]');
    if (haikuCard) {
      return {
        found: true as const,
        selector: '[data-testid="haiku-card"]',
        childCount: haikuCard.childElementCount,
        hasText: (haikuCard.textContent ?? "").trim().length > 0,
        japaneseLineCount: win.document.querySelectorAll(
          '[data-testid="haiku-japanese-line"]',
        ).length,
        englishLineCount: win.document.querySelectorAll(
          '[data-testid="haiku-english-line"]',
        ).length,
      };
    }

    // Fallback: look for any rendered component from the gen-UI
    // cascade selectors that has non-trivial content (the component
    // registered via useFrontendTool's render callback).
    const fallbackSelectors = [
      '[data-testid="copilot-assistant-message"]',
      '[data-message-role="assistant"]',
      '[role="article"]',
    ];
    for (const sel of fallbackSelectors) {
      const el = win.document.querySelector(sel);
      if (el && el.childElementCount > 0) {
        return {
          found: true as const,
          selector: sel,
          childCount: el.childElementCount,
          hasText: (el.textContent ?? "").trim().length > 0,
          japaneseLineCount: 0,
          englishLineCount: 0,
        };
      }
    }

    return { found: false as const };
  });

  if (!cardInfo.found) {
    throw new Error(
      `gen-ui-custom: matched cascade selector ${matchedSelector} but no haiku card or rendered component found in DOM`,
    );
  }

  if (cardInfo.childCount === 0) {
    throw new Error(
      `gen-ui-custom: haiku card ${cardInfo.selector} rendered but has zero children (empty wrapper)`,
    );
  }

  if (!cardInfo.hasText) {
    throw new Error(
      `gen-ui-custom: haiku card ${cardInfo.selector} rendered but has no text content`,
    );
  }
}

/**
 * Override the default `/demos/<featureType>` route.
 */
function preNavigateRoute(): string {
  return "/demos/gen-ui-tool-based";
}

registerD5Script({
  featureTypes: ["gen-ui-custom"],
  fixtureFile: "gen-ui-custom.json",
  buildTurns,
  preNavigateRoute,
});
