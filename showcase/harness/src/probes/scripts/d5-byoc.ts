/**
 * D5 — byoc script.
 *
 * Covers `/demos/{byoc,declarative}-hashbrown` and
 * `/demos/{byoc,declarative}-json-render` via `preNavigateRoute` —
 * both slug families resolve to the same `byoc` D5 featureType.
 * (Most integrations still use the legacy `byoc-*` slugs;
 * langgraph-python's were renamed to `declarative-*` to drop internal
 * jargon — see d5-feature-mapping.ts for the map and the
 * integration's manifest for the per-cell ID.)
 * Both demos render structured-output via a user-supplied component
 * (the BYOC contract): the agent emits a JSON payload, the demo's
 * custom renderer materializes it as structured DOM (metric cards +
 * charts).
 *
 * Fixture matching: the BYOC pill prompts have dedicated fixtures in
 * `showcase/aimock/feature-parity.json` (added in main:f0a89b843)
 * keyed on the full pill-prompt sentences. We send one of those
 * prompts (the "Sales dashboard" pill) so aimock returns a JSON-shaped
 * response the demo's renderer can parse — sending generic prompts
 * leaves the renderer with nothing to materialize and the assertion
 * never sees a tile in DOM.
 *
 * Assertion: wait for the rendered metric card AND a chart to appear.
 * Both demos emit a metric card + chart for the Sales dashboard pill,
 * so a single selector cascade works for both.
 */

import { registerD5Script } from "../helpers/d5-registry.js";
import type {
  D5BuildContext,
  D5FeatureType,
  D5RouteContext,
} from "../helpers/d5-registry.js";
import type { ConversationTurn, Page } from "../helpers/conversation-runner.js";

/** Selector for the rendered metric card — present in both demos. */
export const METRIC_CARD_SELECTOR = '[data-testid="metric-card"]';
/** Selector for either chart variant — present in the Sales dashboard pill response. */
export const CHART_SELECTORS = [
  '[data-testid="bar-chart"]',
  '[data-testid="pie-chart"]',
] as const;

/** Pill prompt for byoc-hashbrown (matches feature-parity.json fixture). */
export const HASHBROWN_PILL =
  "Show me a Q4 sales dashboard. Include a total-revenue metric card, a pie chart of revenue by segment, and a bar chart of monthly revenue.";
/** Pill prompt for byoc-json-render (matches feature-parity.json fixture). */
export const JSON_RENDER_PILL =
  "Show me the sales dashboard with metrics and a revenue chart";

const RENDER_TIMEOUT_MS = 15_000;

/** Probe whether the metric-card AND at least one chart selector are
 *  visible in DOM. Returns null on success, error string on timeout. */
async function probeRenderedComponents(page: Page): Promise<{
  hasMetric: boolean;
  hasChart: boolean;
  matchedChart: string | null;
}> {
  return (await page.evaluate(() => {
    const win = globalThis as unknown as {
      document: { querySelector(sel: string): unknown };
    };
    const hasMetric = Boolean(
      win.document.querySelector('[data-testid="metric-card"]'),
    );
    let matchedChart: string | null = null;
    for (const sel of [
      '[data-testid="bar-chart"]',
      '[data-testid="pie-chart"]',
    ]) {
      if (win.document.querySelector(sel)) {
        matchedChart = sel;
        break;
      }
    }
    return { hasMetric, hasChart: matchedChart !== null, matchedChart };
  })) as { hasMetric: boolean; hasChart: boolean; matchedChart: string | null };
}

export function buildByocAssertion(opts?: {
  timeoutMs?: number;
}): (page: Page) => Promise<void> {
  const timeout = opts?.timeoutMs ?? RENDER_TIMEOUT_MS;
  return async (page: Page): Promise<void> => {
    const deadline = Date.now() + timeout;
    let last = {
      hasMetric: false,
      hasChart: false,
      matchedChart: null as string | null,
    };
    while (Date.now() < deadline) {
      last = await probeRenderedComponents(page);
      if (last.hasMetric && last.hasChart) return;
      await new Promise<void>((r) => setTimeout(r, 250));
    }
    const missing: string[] = [];
    if (!last.hasMetric) missing.push(METRIC_CARD_SELECTOR);
    if (!last.hasChart) missing.push(`one of [${CHART_SELECTORS.join(", ")}]`);
    throw new Error(
      `byoc: structured-output renderer did not produce expected components within ${timeout}ms — missing: ${missing.join(", ")}`,
    );
  };
}

export function buildTurns(ctx: D5BuildContext): ConversationTurn[] {
  // The driver fans out one run per featureType per integration. The
  // `byoc` literal covers BOTH the hashbrown demo and the json-render
  // demo via preNavigateRoute (below). Both slug families resolve here
  // (legacy `byoc-{hashbrown,json-render}` plus langgraph-python's
  // renamed `declarative-{hashbrown,json-render}`). The pill prompt
  // that aimock matches depends on which route we navigated to.
  //
  // Since buildTurns runs BEFORE we know which route was navigated to
  // (the runner doesn't expose post-nav info), we send the
  // "Sales dashboard" pill prompt that produces a response with both
  // a metric card and a chart on either route. The integration's
  // feature-parity.json has dedicated fixtures for each demo's pill
  // prompts.
  //
  // We default to the hashbrown pill (longer, more specific). If the
  // integration only declares the json-render demo, the route will
  // navigate there and the SHORTER json-render pill prompt would be
  // needed instead — but `forwardedProps` on each pill match
  // independently, so sending the hashbrown prompt on the json-render
  // page will fall through to a different fixture (or the generic
  // chat fixture). To avoid that ambiguity, peek at the integration's
  // demos via the build context and pick the right pill.
  //
  // NOTE: D5BuildContext doesn't currently expose `demos[]` — the
  // route fan-out info lives only in D5RouteContext used by
  // preNavigateRoute. The pragmatic behaviour: always use the
  // hashbrown pill. The hashbrown demo is the more common deployment
  // (per main); json-render-only integrations would need a separate
  // featureType split if they need their own assertion.
  const _ = ctx;
  return [
    {
      input: HASHBROWN_PILL,
      assertions: buildByocAssertion(),
    },
  ];
}

/** Pick the navigated demo: prefer hashbrown if available, else json-render. */
export function preNavigateRoute(
  _ft: D5FeatureType,
  ctx?: D5RouteContext,
): string {
  // Both ID forms — the legacy `byoc-*` and langgraph-python's renamed
  // `declarative-*` — point at the same demo. Match either, navigating
  // to the slug the integration actually serves.
  if (ctx?.demos?.includes("declarative-hashbrown")) {
    return "/demos/declarative-hashbrown";
  }
  if (ctx?.demos?.includes("byoc-hashbrown")) {
    return "/demos/byoc-hashbrown";
  }
  if (ctx?.demos?.includes("declarative-json-render")) {
    return "/demos/declarative-json-render";
  }
  if (ctx?.demos?.includes("byoc-json-render")) {
    return "/demos/byoc-json-render";
  }
  return "/demos/byoc-hashbrown";
}

registerD5Script({
  featureTypes: ["byoc"],
  fixtureFile: "feature-parity.json",
  buildTurns,
  preNavigateRoute,
});
