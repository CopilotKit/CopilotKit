/**
 * D5 — gen-UI (custom) script.
 *
 * Probes the showcase's `/demos/gen-ui-tool-based` page. Every
 * `gen-ui-tool-based` integration registers the SAME chart tools
 * (`render_bar_chart` + `render_pie_chart`) via `useComponent`, so this
 * is a SHARED probe with ONE contract (Showcase iron rule 1): send the
 * pie-chart prompt and assert the pie-chart rendering shape for EVERY
 * integration — no per-slug branching.
 *
 * Why "custom" is stricter than "headless":
 *   - `headless` checks that *some* component rendered with
 *     non-trivial structure.
 *   - `custom` additionally asserts the rendered shape MATCHES the
 *     expected structure for the recorded tool:
 *       - `render_pie_chart`: `<svg>` with multiple drawing elements
 *       - the second-leg narration mentions the chart
 */

import { registerD5Script } from "../helpers/d5-registry.js";
import type { D5BuildContext } from "../helpers/d5-registry.js";
import type { ConversationTurn, Page } from "../helpers/conversation-runner.js";
import { readSvgChartShape, waitForGenUiComponent } from "./_gen-ui-shared.js";

/**
 * Lower-bound for the donut chart's drawing-child count (pie chart path).
 */
const MIN_CHART_DRAWING_CHILDREN = 2;

/**
 * Follow-up tokens for the pie chart path. Token-level check guards
 * against a silent regression where the chart renders but the second
 * LLM leg never fires.
 */
const PIE_CHART_FOLLOWUP_TOKENS = ["pie", "chart"] as const;

/**
 * User message for the shared pie-chart contract. Must match the
 * fixture's `match.userMessage` entry exactly.
 */
const PIE_CHART_USER_MESSAGE = "Show me a pie chart of revenue by category";

export function buildTurns(ctx: D5BuildContext): ConversationTurn[] {
  console.debug("[d5-gen-ui-custom] buildTurns", {
    slug: ctx.integrationSlug,
    inputLength: PIE_CHART_USER_MESSAGE.length,
  });

  return [
    {
      input: PIE_CHART_USER_MESSAGE,
      assertions: async (page, assertionCtx) => {
        // 1. Cascade-find the rendered component. Gen-UI components
        //    surface through the same selector hooks regardless of which
        //    tool fired.
        console.debug("[d5-gen-ui-custom] waiting for gen-UI component");
        const matchedSelector = await waitForGenUiComponent(page);
        console.debug("[d5-gen-ui-custom] gen-UI component found", {
          matchedSelector,
        });

        console.debug("[d5-gen-ui-custom] asserting pie chart shape");
        await assertPieChartShape(page, matchedSelector);

        // Narration check: the second-leg LLM response must mention the
        // chart. Token-level so wording drift doesn't fail the probe.
        //
        // `assertionCtx.text` is the SAME turn-scoped text resolved by
        // the runner's settle path — the values returned by
        // `waitForTurnComplete` (turn-indexed bubble lookup, defect-2
        // safe). We no longer read `readLastAssistantText` here because
        // that returned `list[list.length - 1]` and could leak a later
        // turn's bubble into THIS turn's assertions.
        //
        // `ctx` is REQUIRED on the runner's `ConversationTurn` type;
        // unit tests driving `turn.assertions` directly must supply a
        // synthetic ctx (`{ bubbleIndex, text }`).
        const text = assertionCtx.text.toLowerCase();
        console.debug("[d5-gen-ui-custom] pie chart follow-up text check", {
          expectedTokenCount: PIE_CHART_FOLLOWUP_TOKENS.length,
          assistantTextLength: text.length,
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
      },
    },
  ];
}

/**
 * Assert the SVG chart shape (`render_pie_chart`).
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
