/**
 * D5 — gen-ui-declarative script.
 *
 * Drives `/demos/declarative-gen-ui`, where the agent emits A2UI
 * `render_a2ui` payloads and the declarative renderer catalog
 * (Card / StatusBadge / Metric / PieChart / BarChart) materializes
 * them as React components. Each renderer carries a stable testid so
 * the probe can assert which catalog component was actually painted
 * for a given pill.
 *
 * Genuine assertion: for each suggestion-pill prompt, capture the
 * mounted-testid set BEFORE the pill is sent (`preFill` hook), then
 * after settle assert ALL expected testids for that pill are present
 * AND at least one of them is newly mounted (i.e. wasn't already in
 * the baseline). Different pills exercise different subsets of the
 * catalog (KPI dashboard hits Metric + Card; pie-chart pill hits
 * PieChart; bar-chart pill hits BarChart; status-report hits
 * StatusBadge), so a regression that returns the same canned UI for
 * every pill turns the probe red on the second pill.
 *
 * The "newly mounted" signal is essential because A2UI nodes
 * accumulate in the DOM across pills — pill 1 (kpi-dashboard) mounts
 * `declarative-card`, which is then carried into pill 4
 * (status-report) where it would trivially satisfy a card-or-badge
 * disjunction. We require the status-report pill's distinguishing
 * testid (`declarative-status-badge`) explicitly and gate the pass
 * on it being newly mounted.
 *
 * Pill prompts are read from `declarative-gen-ui/suggestions.ts` so
 * the prompts in this probe stay in sync with the demo's pill set.
 */

import {
  registerD5Script,
  type D5BuildContext,
  type D5FeatureType,
} from "../helpers/d5-registry.js";
import type { ConversationTurn, Page } from "../helpers/conversation-runner.js";
import { FIRST_SIGNAL_TIMEOUT_MS } from "./_genuine-shared.js";

/** Default `/demos/<featureType>` would be `/demos/gen-ui-declarative`,
 *  which does not exist — the actual route uses the registry-id
 *  `declarative-gen-ui`. */
export function preNavigateRoute(_ft: D5FeatureType): string {
  return "/demos/declarative-gen-ui";
}

/** Pill prompts MUST mirror `declarative-gen-ui/suggestions.ts`.
 *  Each pill names the catalog component testids that MUST ALL render
 *  for the pill to pass. The check is conjunctive (`every`) so we
 *  cannot trivially pass on a leftover testid from an earlier pill —
 *  e.g. status-report cannot pass on pill-1's `declarative-card`,
 *  because it now requires `declarative-status-badge` (pill 1 doesn't
 *  mount that). */
export const GEN_UI_DECLARATIVE_PILLS = [
  {
    tag: "kpi-dashboard",
    prompt:
      "Show me a quick KPI dashboard with 3-4 metrics (revenue, signups, churn).",
    expectedTestIds: ["declarative-card", "declarative-metric"] as const,
  },
  {
    tag: "pie-chart",
    prompt: "Show a pie chart of sales by region.",
    expectedTestIds: ["declarative-pie-chart"] as const,
  },
  {
    tag: "bar-chart",
    prompt: "Render a bar chart of quarterly revenue.",
    expectedTestIds: ["declarative-bar-chart"] as const,
  },
  {
    tag: "status-report",
    prompt:
      "Give me a status report on system health — API, database, and background workers.",
    // Distinguishing testid: status-report MUST mount the status
    // badge. Pill 1 (kpi-dashboard) already mounted `declarative-card`,
    // so that testid is leftover by the time we get here and was
    // previously masking the lack of a real status-report render.
    expectedTestIds: ["declarative-status-badge"] as const,
  },
] as const;

/** Read whether ANY of a known set of declarative testids is present.
 *  All five testids are inlined as literal selectors so the closure
 *  doesn't need to capture arguments — `_beautiful-chat-shared.ts`
 *  uses the same pattern. */
async function readDeclarativeTestIds(page: Page): Promise<{
  card: boolean;
  metric: boolean;
  statusBadge: boolean;
  pieChart: boolean;
  barChart: boolean;
}> {
  return (await page.evaluate(() => {
    const win = globalThis as unknown as {
      document: { querySelector(sel: string): unknown };
    };
    return {
      card: !!win.document.querySelector('[data-testid="declarative-card"]'),
      metric: !!win.document.querySelector(
        '[data-testid="declarative-metric"]',
      ),
      statusBadge: !!win.document.querySelector(
        '[data-testid="declarative-status-badge"]',
      ),
      pieChart: !!win.document.querySelector(
        '[data-testid="declarative-pie-chart"]',
      ),
      barChart: !!win.document.querySelector(
        '[data-testid="declarative-bar-chart"]',
      ),
    };
  })) as {
    card: boolean;
    metric: boolean;
    statusBadge: boolean;
    pieChart: boolean;
    barChart: boolean;
  };
}

const TESTID_TO_KEY: Record<
  string,
  keyof Awaited<ReturnType<typeof readDeclarativeTestIds>>
> = {
  "declarative-card": "card",
  "declarative-metric": "metric",
  "declarative-status-badge": "statusBadge",
  "declarative-pie-chart": "pieChart",
  "declarative-bar-chart": "barChart",
};

/** Per-pill baseline ref: which declarative testids were already
 *  mounted in the DOM BEFORE the pill was sent. Closed over by both
 *  the `preFill` hook (writes) and the assertion (reads). Necessary
 *  because A2UI render nodes accumulate across pills, so an absolute
 *  presence check would trivially pass on leftover renders from
 *  earlier pills. */
export interface DeclarativeBaselineRef {
  testIds: Awaited<ReturnType<typeof readDeclarativeTestIds>>;
  captured: boolean;
}

/** Build the `preFill` hook that captures the declarative-testid set
 *  before the pill is sent. */
export function buildBaselineCapture(
  ref: DeclarativeBaselineRef,
): (page: Page) => Promise<void> {
  return async (page: Page): Promise<void> => {
    const state = await readDeclarativeTestIds(page);
    ref.testIds = state;
    ref.captured = true;
  };
}

/** Build a per-pill assertion. Pass condition:
 *    - ALL expected testids are present in the DOM at settle, AND
 *    - at least one expected testid was newly mounted (i.e. NOT in
 *      the pre-pill baseline) — this guards against trivial passes
 *      on leftover renders from earlier pills.
 */
export function buildDeclarativeAssertion(
  pillTag: string,
  expectedTestIds: readonly string[],
  baselineRef: DeclarativeBaselineRef,
): (page: Page) => Promise<void> {
  const expectedKeys = expectedTestIds.map((id) => {
    const key = TESTID_TO_KEY[id];
    if (!key) {
      throw new Error(
        `gen-ui-declarative-${pillTag}: unknown expected testid "${id}"`,
      );
    }
    return key;
  });
  return async (page: Page): Promise<void> => {
    if (!baselineRef.captured) {
      throw new Error(
        `gen-ui-declarative-${pillTag}: baseline was not captured by preFill (test wiring error)`,
      );
    }
    const deadline = Date.now() + FIRST_SIGNAL_TIMEOUT_MS;
    let last: Awaited<ReturnType<typeof readDeclarativeTestIds>> = {
      card: false,
      metric: false,
      statusBadge: false,
      pieChart: false,
      barChart: false,
    };
    while (Date.now() < deadline) {
      last = await readDeclarativeTestIds(page);
      const allPresent = expectedKeys.every((k) => last[k]);
      const anyNewlyMounted = expectedKeys.some(
        (k) => last[k] && !baselineRef.testIds[k],
      );
      if (allPresent && anyNewlyMounted) return;
      await new Promise((r) => setTimeout(r, 300));
    }
    const missing = expectedKeys
      .filter((k) => !last[k])
      .map((k) => `${k}=false`);
    const leftoverOnly = expectedKeys
      .filter((k) => last[k] && baselineRef.testIds[k])
      .map((k) => `${k}=leftover`);
    throw new Error(
      `gen-ui-declarative-${pillTag}: pill did not produce all expected testids ` +
        `[${expectedTestIds.join(", ")}] within ${FIRST_SIGNAL_TIMEOUT_MS}ms ` +
        `(missing: [${missing.join(", ")}]; leftover-only: [${leftoverOnly.join(", ")}])`,
    );
  };
}

export function buildTurns(_ctx: D5BuildContext): ConversationTurn[] {
  return GEN_UI_DECLARATIVE_PILLS.map(({ tag, prompt, expectedTestIds }) => {
    const baselineRef: DeclarativeBaselineRef = {
      testIds: {
        card: false,
        metric: false,
        statusBadge: false,
        pieChart: false,
        barChart: false,
      },
      captured: false,
    };
    return {
      input: prompt,
      preFill: buildBaselineCapture(baselineRef),
      assertions: buildDeclarativeAssertion(tag, expectedTestIds, baselineRef),
      responseTimeoutMs: 60_000,
    };
  });
}

registerD5Script({
  featureTypes: ["gen-ui-declarative"],
  fixtureFile: "gen-ui-declarative.json",
  buildTurns,
  preNavigateRoute,
});
