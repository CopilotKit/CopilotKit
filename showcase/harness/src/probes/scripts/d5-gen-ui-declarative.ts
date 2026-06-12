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
 * catalog (the sales-dashboard hero pill hits Card + Metric +
 * PieChart + BarChart in one composed surface; team-performance hits
 * DataTable; at-risk hits StatusBadge; top-account hits InfoRow), so
 * a regression that returns the same canned UI for every pill turns
 * the probe red on the second pill.
 *
 * The "newly mounted" signal is essential because A2UI nodes
 * accumulate in the DOM across pills — pill 1 (sales-dashboard)
 * mounts `declarative-card`, which is then carried into later pills
 * where it would trivially satisfy a disjunction. Each later pill's
 * distinguishing testid (data-table / status-badge / info-row) is a
 * component the hero dashboard is steered NOT to use (see the
 * composition rules in `declarative-gen-ui/sales-context.ts`), so it
 * can only appear by that pill newly mounting it.
 *
 * Pill prompts are read from `declarative-gen-ui/suggestions.ts` so
 * the prompts in this probe stay in sync with the demo's pill set.
 */

import { registerD5Script } from "../helpers/d5-registry.js";
import type { D5BuildContext, D5FeatureType } from "../helpers/d5-registry.js";
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
 *  pills 2-4 each require a component the hero dashboard (pill 1) is
 *  steered not to mount. */
export const GEN_UI_DECLARATIVE_PILLS = [
  {
    tag: "sales-dashboard",
    prompt: "Show me my sales dashboard for this quarter.",
    // The hero pill: one composed surface with a bare KPI metric row +
    // both charts (no surrounding Card — the charts carry their own card
    // chrome). Conjunctive across all three testids so a single lonely
    // widget cannot pass as a "dashboard".
    expectedTestIds: [
      "declarative-metric",
      "declarative-pie-chart",
      "declarative-bar-chart",
    ] as const,
  },
  {
    tag: "team-performance",
    prompt: "How are our sales reps performing against quota?",
    expectedTestIds: ["declarative-data-table"] as const,
  },
  {
    tag: "at-risk",
    prompt: "Are any accounts or pipeline deals at risk this quarter?",
    expectedTestIds: ["declarative-status-badge"] as const,
  },
  {
    tag: "top-account",
    prompt: "Pull up the details on our biggest account.",
    expectedTestIds: ["declarative-info-row"] as const,
  },
] as const;

/** Read whether ANY of a known set of declarative testids is present.
 *  All seven testids are inlined as literal selectors so the closure
 *  doesn't need to capture arguments — `_beautiful-chat-shared.ts`
 *  uses the same pattern. */
async function readDeclarativeTestIds(page: Page): Promise<{
  card: boolean;
  metric: boolean;
  statusBadge: boolean;
  pieChart: boolean;
  barChart: boolean;
  dataTable: boolean;
  infoRow: boolean;
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
      dataTable: !!win.document.querySelector(
        '[data-testid="declarative-data-table"]',
      ),
      infoRow: !!win.document.querySelector(
        '[data-testid="declarative-info-row"]',
      ),
    };
  })) as {
    card: boolean;
    metric: boolean;
    statusBadge: boolean;
    pieChart: boolean;
    barChart: boolean;
    dataTable: boolean;
    infoRow: boolean;
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
  "declarative-data-table": "dataTable",
  "declarative-info-row": "infoRow",
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
      dataTable: false,
      infoRow: false,
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
        dataTable: false,
        infoRow: false,
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
