/**
 * D5 — gen-UI (custom) script.
 *
 * Probes the showcase's `/demos/gen-ui-tool-based` page against the
 * frontend-defined `render_pie_chart` tool (registered via
 * `useComponent` in `gen-ui-tool-based/page.tsx`). The fixture
 * (`fixtures/d5/gen-ui-custom.json`) drives the agent to call
 * `render_pie_chart` with title/description/data; the page renders the
 * `PieChart` React component (`gen-ui-tool-based/pie-chart.tsx`).
 *
 * Why "custom" is stricter than "headless":
 *   - `headless` checks that *some* component rendered with
 *     non-trivial structure.
 *   - `custom` additionally asserts the rendered shape MATCHES the
 *     expected structure for the recorded tool. For `render_pie_chart`
 *     that's an `<svg>` containing multiple drawing elements (the
 *     `PieChart` implementation renders one `<circle>` per slice plus
 *     a single background `<circle>`, so a 4-slice fixture produces
 *     5 circles total).
 *
 * Two-turn shape (mirrors the recorded fixture):
 *   1. User: "Show me a pie chart of revenue by category"
 *      → Agent calls `render_pie_chart` with 4 slices (Electronics,
 *        Clothing, Food, Books) → frontend renders `PieChart`
 *        (donut SVG with 5 circles + a legend block) → second-leg
 *        narration ("Pie chart rendered above ...").
 */

import { registerD5Script } from "../helpers/d5-registry.js";
import type { D5BuildContext } from "../helpers/d5-registry.js";
import type { ConversationTurn } from "../helpers/conversation-runner.js";
import {
  readLastAssistantText,
  readSvgChartShape,
  waitForGenUiComponent,
} from "./_gen-ui-shared.js";

/**
 * Lower-bound for the donut chart's drawing-child count. The `PieChart`
 * implementation renders one `<circle>` per slice (4 slices in the
 * recorded fixture) + a single background `<circle>` = 5 circles. We
 * assert `>= 2` rather than `=== 5` to stay robust to the showcase
 * tweaking the chart implementation (e.g. dropping the background
 * circle, switching to `<path>` arcs, adding rect-based labels). The
 * lower bound rejects "empty SVG placeholder" (zero children) and
 * "single-element SVG" (could be a generic icon, not a chart).
 */
const MIN_CHART_DRAWING_CHILDREN = 2;

/**
 * Tokens we expect in the assistant's narration after the chart
 * renders. The fixture writes "Pie chart rendered above — Electronics
 * is the largest slice ..." — checking "pie" + "chart" guards against
 * a silent regression where the chart renders but the second LLM leg
 * never fires.
 */
const FOLLOWUP_TOKENS = ["pie", "chart"] as const;

export function buildTurns(_ctx: D5BuildContext): ConversationTurn[] {
  return [
    {
      input: "Show me a pie chart of revenue by category",
      assertions: async (page) => {
        // 1. Cascade-find the rendered component (same cascade as the
        //    headless script — gen-UI components surface through the
        //    same set of selector hooks regardless of which tool fired).
        const matchedSelector = await waitForGenUiComponent(page);

        // 2. STRUCTURAL match. The donut PieChart renders inside an
        //    `<svg>` with multiple `<circle>` children. Read the SVG
        //    shape and assert the lower bound on drawing children. A
        //    plain text response, an empty wrapper, or a non-chart
        //    custom component (e.g. a card) would fail this check —
        //    that strictness is the whole point of the custom tier.
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
        // The reference implementation uses `<circle>` slices. We
        // accept any of circle/path/rect to stay robust to alternative
        // chart libraries (e.g. recharts uses `<path>`), but the
        // *combined* count must clear the floor. If a future variant
        // drops to a single drawing element we want a loud failure
        // because that's almost certainly an empty/placeholder render.
        if (shape.circleCount === 0 && shape.pathCount === 0) {
          throw new Error(
            `gen-ui-custom: SVG has neither <circle> nor <path> elements (rects=${shape.rectCount}); shape doesn't match a chart`,
          );
        }

        // 3. Narration check. Like the headless variant, token-level
        //    so wording drift across integrations doesn't fail the
        //    probe — but the second LLM leg must have fired.
        const text = (await readLastAssistantText(page)).toLowerCase();
        const missing = FOLLOWUP_TOKENS.filter((tok) => !text.includes(tok));
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
 * Override the default `/demos/<featureType>` route. The fixture is
 * recorded against `/demos/gen-ui-tool-based` (where the
 * `render_pie_chart` `useComponent` registration lives), not the
 * literal feature type slug. Mirrors the mcp-apps → /demos/subagents
 * override pattern documented in the registry comments.
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
