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
 * catalog (the sales-dashboard hero pill hits Metric + PieChart +
 * BarChart in one composed surface — no surrounding Card, per the
 * OSS-136 rule; team-performance hits DataTable; at-risk hits
 * StatusBadge alongside a KPI Metric strip; top-account hits
 * InfoRow), so a regression that returns the same canned UI for
 * every pill turns the probe red on the second pill.
 *
 * The "newly mounted" signal is essential because A2UI nodes
 * accumulate in the DOM across pills — earlier pills mount their
 * components (e.g. metric/pie/bar from the hero), which would
 * trivially satisfy a leftover-friendly disjunction on a later pill.
 * Each later pill's distinguishing testid (data-table / status-badge /
 * info-row) is a component the hero dashboard is steered NOT to use
 * (see the composition rules in `declarative-gen-ui/sales-context.ts`),
 * so it can only appear by that pill newly mounting it.
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
    buttonName: "Show my sales dashboard",
    prompt: "Show me my sales dashboard for this quarter.",
    // The hero pill: one composed surface with a bare KPI metric row
    // of 4 tiles + both charts (no surrounding Card — the charts
    // carry their own card chrome). Conjunctive across all three
    // testids so a single lonely widget cannot pass as a "dashboard".
    // `minCounts` enforces the 4-tile KPI strip from the composition
    // rule (see sales-context.ts rule 1) — combined with the
    // newly-mounted delta gate this means at least 4 metrics must
    // mount on this pill, guarding against under-composition.
    expectedTestIds: [
      "declarative-metric",
      "declarative-pie-chart",
      "declarative-bar-chart",
    ] as const,
    minCounts: {
      "declarative-metric": 4,
      "declarative-pie-chart": 1,
      "declarative-bar-chart": 1,
    } as Record<string, number>,
  },
  {
    tag: "team-performance",
    buttonName: "Team performance",
    prompt: "How are our sales reps performing against quota?",
    // Per composition rule 2: a DataTable next to or above a BarChart
    // of quota attainment % per rep. Both must newly mount — the
    // chart sibling was previously unasserted, letting a table-only
    // response pass.
    expectedTestIds: ["declarative-data-table"] as const,
    minCounts: {
      "declarative-data-table": 1,
      "declarative-bar-chart": 1,
    } as Record<string, number>,
  },
  {
    tag: "at-risk",
    buttonName: "Anything at risk?",
    prompt: "Are any accounts or pipeline deals at risk this quarter?",
    // Status-badge stays the distinguishing testid the hero does not
    // mount (see the cross-pill differentiation invariant). The
    // at-risk surface also renders a KPI strip of three metric tiles
    // (ARR at risk / accounts / biggest exposure) + three severity
    // cards — those counts are asserted via `minCounts` below as
    // newly-mounted deltas so leftover hero metrics cannot satisfy
    // the at-risk composition rule.
    expectedTestIds: ["declarative-status-badge"] as const,
    minCounts: {
      "declarative-status-badge": 3,
      "declarative-metric": 3,
    } as Record<string, number>,
  },
  {
    tag: "top-account",
    buttonName: "Top account details",
    prompt: "Pull up the details on our biggest account.",
    // Per composition rule 4: a Card of InfoRow facts next to a
    // PieChart of that account's revenue by product line. The chart
    // sibling was previously unasserted; minCounts forces the pie to
    // newly mount, so a hero leftover pie does not satisfy the
    // top-account composition.
    expectedTestIds: ["declarative-info-row"] as const,
    minCounts: {
      "declarative-info-row": 1,
      "declarative-pie-chart": 1,
    } as Record<string, number>,
  },
] as const;

// Expected visible values come from the canonical LGP sales-context.ts dataset,
// independently of the candidate render. Narration and widget counts cannot
// substitute for these values in freshly mounted, visible renderer content.
async function assertCanonicalPillInventory(page: Page): Promise<void> {
  await page.waitForSelector('[data-testid="copilot-suggestion"]', {
    state: "visible",
    timeout: 5_000,
  });
  const names = await page.evaluate(
    new Function(
      `return Array.from(document.querySelectorAll('[data-testid="copilot-suggestion"]')).map(button => button.innerText);`,
    ) as () => string[],
  );
  const expected = GEN_UI_DECLARATIVE_PILLS.map((pill) => pill.buttonName);
  if (JSON.stringify(names) !== JSON.stringify(expected)) {
    throw new Error(
      "declarative canonical pill inventory differs (missing, extra, reordered or renamed pill)",
    );
  }
}

async function assertCanonicalVisibleValues(
  page: Page,
  tag: string,
  baseline: DeclarativeCounts,
): Promise<void> {
  const observed = await page.evaluate(
    new Function(`
    const visible = e => e.getClientRects().length > 0 && getComputedStyle(e).visibility !== 'hidden';
    const fresh = (id, n) => Array.from(document.querySelectorAll('[data-testid="'+id+'"]')).slice(n).filter(visible);
    const cells = e => Array.from(e.querySelectorAll('span')).filter(visible).map(s => s.textContent);
    return {
      metrics: fresh('declarative-metric', ${baseline.metric}).map(cells),
      rows: fresh('declarative-data-table', ${baseline.dataTable}).flatMap(t => Array.from(t.querySelectorAll('tbody tr')).filter(visible).map(r => Array.from(r.querySelectorAll('td')).map(c => c.innerText))),
      info: fresh('declarative-info-row', ${baseline.infoRow}).map(cells),
      cards: fresh('declarative-card', ${baseline.card}).map(c => ({title:c.querySelector(':scope > div > div')?.textContent,text:c.innerText,info:Array.from(c.querySelectorAll('[data-testid="declarative-info-row"]')).filter(visible).map(cells)})),
      errors: [...Array.from(document.querySelectorAll('[data-testid="copilot-error-banner"], [role="alert"]')).filter(visible), ...Array.from(document.querySelectorAll('[data-testid="copilot-chat"] *')).filter(e => visible(e) && e.children.length === 0 && /^Catalog not found:/.test(e.textContent ?? ''))].map(e => e.innerText)
    };
  `) as () => {
      metrics: string[][];
      rows: string[][];
      info: string[][];
      cards: { title: string; text: string; info: string[][] }[];
      errors: string[];
    },
  );
  if (observed.errors.length)
    throw new Error(
      `declarative ${tag} has an unexpected visible renderer error`,
    );
  const requireRow = (rows: string[][], expected: readonly string[]) => {
    if (
      !rows.some((row) =>
        expected.every((value, index) => row[index] === value),
      )
    )
      throw new Error(
        `declarative ${tag} missing canonical label/value relationship: ${expected.join(" / ")}`,
      );
  };
  const reps = [
    ["Dana Whitfield", 124],
    ["Marcus Lee", 108],
    ["Priya Sharma", 97],
    ["Tom Okafor", 88],
    ["Elena Vasquez", 71],
  ] as const;
  if (tag === "sales-dashboard") {
    for (const metric of [
      ["Quarterly Revenue", "$4.2M", "↑ +12% QoQ"],
      ["New Customers", "186", "↑ +8%"],
      ["Win Rate", "31%", "↓ -2 pts"],
      ["Avg Deal Size", "$22.6k", "↑ +5%"],
    ])
      requireRow(observed.metrics, metric);
    await assertChart(page, "pie", baseline.pieChart, [
      ["North America", 1900000],
      ["EMEA", 1300000],
      ["APAC", 720000],
      ["LATAM", 280000],
    ]);
    await assertChart(page, "bar", baseline.barChart, [
      ["Jan", 1210000],
      ["Feb", 1340000],
      ["Mar", 1650000],
      ["Apr", 1380000],
      ["May", 1420000],
      ["Jun", 1400000],
    ]);
  }
  if (tag === "team-performance") {
    for (const [name, value] of reps)
      requireRow(observed.rows, [name, `${value}%`]);
    await assertChart(page, "bar", baseline.barChart, reps);
  }
  if (tag === "at-risk") {
    for (const metric of [
      ["ARR at risk", "$615k", "↓ 3 accounts"],
      ["Accounts at risk", "3", "→ This quarter"],
      ["Biggest exposure", "Northwind Retail", "↓ $340k renewal"],
    ])
      requireRow(observed.metrics, metric);
    for (const [title, amount, severity, reason, advice] of [
      [
        "Northwind Retail",
        "$340k",
        "High severity",
        "No contact in 6 weeks",
        "exec outreach this week to protect the renewal",
      ],
      [
        "Cascadia Outfitters",
        "$180k",
        "Medium severity",
        "Champion left",
        "rebuild stakeholder map and secure a new sponsor",
      ],
      [
        "Atlas Goods",
        "$95k",
        "Medium severity",
        "Legal review is stalled",
        "align procurement and legal on open terms",
      ],
    ]) {
      const card = observed.cards.find((c) => c.title === title);
      if (
        !card ||
        !card.text.includes(`${amount} ARR at stake`) ||
        !card.text.includes(severity!) ||
        !card.text.includes(reason!) ||
        !card.text.includes(advice!)
      )
        throw new Error(`canonical risk card differs: ${title}`);
    }
  }
  if (tag === "top-account") {
    const account = observed.cards.find(
      (c) => c.title === "Meridian Apparel Group",
    );
    if (!account) throw new Error("canonical account card missing");
    for (const pair of [
      ["Owner", "Dana Whitfield"],
      ["Region", "North America"],
      ["ARR", "$612k"],
      ["Renewal date", "Sep 30"],
      ["Last contact", "3 days ago"],
      ["Health", "Green"],
      ["Open opportunities", "4 opportunities worth $210k"],
    ])
      requireRow(account.info, pair);
    await assertChart(page, "pie", baseline.pieChart, [
      ["Outerwear", 260000],
      ["Footwear", 180000],
      ["Accessories", 112000],
      ["Custom", 60000],
    ]);
  }
}

// Values must appear in the visible tooltip after an actual pointer hover.
async function assertChart(
  page: Page,
  kind: "pie" | "bar",
  baseline: number,
  expected: readonly (readonly [string, number])[],
): Promise<void> {
  if (!page.hover) throw new Error("real chart hover is unavailable");
  const id = `declarative-${kind}-chart`;
  const mark =
    kind === "pie" ? ".recharts-pie-sector" : ".recharts-bar-rectangle";
  const count = await page.evaluate(
    new Function(
      `return document.querySelectorAll('[data-testid="${id}"]')[${baseline}]?.querySelectorAll('${mark}').length ?? 0`,
    ) as () => number,
  );
  if (count !== expected.length)
    throw new Error(`canonical ${kind} series length differs`);
  for (let index = 0; index < expected.length; index++) {
    await page.hover(
      `:nth-match([data-testid="${id}"], ${baseline + 1}) ${mark} >> nth=${index}`,
      { timeout: 5000 },
    );
    let matches = false;
    const deadline = Date.now() + 2000;
    do {
      const tip = await page.evaluate(
        new Function(`
        const tip=document.querySelectorAll('[data-testid="${id}"]')[${baseline}]?.querySelector('.recharts-tooltip-wrapper');
        if(!tip || getComputedStyle(tip).visibility==='hidden') return null;
        return {label:tip.querySelector('.recharts-tooltip-label')?.textContent ?? '',name:tip.querySelector('.recharts-tooltip-item-name')?.textContent ?? '',value:tip.querySelector('.recharts-tooltip-item-value')?.textContent ?? ''};
      `) as () => { label: string; name: string; value: string } | null,
      );
      const [label, value] = expected[index]!;
      matches =
        !!tip &&
        (kind === "pie" ? tip.name : tip.label) === label &&
        tip.value === String(value);
      if (!matches) await new Promise((resolve) => setTimeout(resolve, 50));
    } while (!matches && Date.now() < deadline);
    if (!matches)
      throw new Error(
        `canonical ${kind} label/value differs: ${expected[index]![0]}`,
      );
  }
}

/** Per-testid counts: `0` is "not present", `>= 1` is "present". Counts
 *  (rather than booleans) lets per-pill `minCounts` rules assert
 *  composition rules that require N copies of the same testid (e.g.
 *  the at-risk surface mounts 3 severity cards + 3 KPI metric tiles).
 *  Boolean presence checks still work transparently — `count > 0` is
 *  truthy, `count === 0` is falsy. */
export type DeclarativeCounts = {
  card: number;
  metric: number;
  statusBadge: number;
  pieChart: number;
  barChart: number;
  dataTable: number;
  infoRow: number;
};

/** Read counts of each known declarative testid. All seven testids
 *  are inlined as literal selectors so the closure doesn't need to
 *  capture arguments — `_beautiful-chat-shared.ts` uses the same
 *  pattern. */
async function readDeclarativeTestIds(page: Page): Promise<DeclarativeCounts> {
  return (await page.evaluate(() => {
    const win = globalThis as unknown as {
      document: { querySelectorAll(sel: string): { length: number } };
    };
    const count = (sel: string): number =>
      win.document.querySelectorAll(sel).length;
    return {
      card: count('[data-testid="declarative-card"]'),
      metric: count('[data-testid="declarative-metric"]'),
      statusBadge: count('[data-testid="declarative-status-badge"]'),
      pieChart: count('[data-testid="declarative-pie-chart"]'),
      barChart: count('[data-testid="declarative-bar-chart"]'),
      dataTable: count('[data-testid="declarative-data-table"]'),
      infoRow: count('[data-testid="declarative-info-row"]'),
    };
  })) as DeclarativeCounts;
}

const TESTID_TO_KEY: Record<string, keyof DeclarativeCounts> = {
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
  testIds: DeclarativeCounts;
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
 *    - at least one expected testid was newly mounted — i.e. its
 *      current count is STRICTLY GREATER than the pre-pill baseline
 *      count. This delta gate guards against trivial passes on
 *      leftover renders from earlier pills (e.g. metric tiles from
 *      the hero), AND
 *    - if `minCounts` is supplied, every named testid must mount at
 *      LEAST `min` NEW copies (current - baseline >= min). The delta
 *      gate is essential because A2UI nodes accumulate across pills,
 *      so an absolute-count check would let a later pill pass on
 *      leftover renders from earlier ones (e.g. at-risk requires
 *      `metric: 3` and the hero already painted 3 metric tiles —
 *      absolute-count gating would falsely pass even if at-risk
 *      mounted zero new metrics).
 */
export function buildDeclarativeAssertion(
  pillTag: string,
  expectedTestIds: readonly string[],
  baselineRef: DeclarativeBaselineRef,
  minCounts?: Record<string, number>,
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
  const minCountKeys: Array<{ key: keyof DeclarativeCounts; min: number }> =
    minCounts
      ? Object.entries(minCounts).map(([id, min]) => {
          const key = TESTID_TO_KEY[id];
          if (!key) {
            throw new Error(
              `gen-ui-declarative-${pillTag}: unknown minCounts testid "${id}"`,
            );
          }
          return { key, min };
        })
      : [];
  return async (page: Page): Promise<void> => {
    if (!baselineRef.captured) {
      throw new Error(
        `gen-ui-declarative-${pillTag}: baseline was not captured by preFill (test wiring error)`,
      );
    }
    const deadline = Date.now() + FIRST_SIGNAL_TIMEOUT_MS;
    let last: DeclarativeCounts = {
      card: 0,
      metric: 0,
      statusBadge: 0,
      pieChart: 0,
      barChart: 0,
      dataTable: 0,
      infoRow: 0,
    };
    while (Date.now() < deadline) {
      last = await readDeclarativeTestIds(page);
      const allPresent = expectedKeys.every((k) => last[k] > 0);
      // Newly mounted = current count grew vs baseline. Counts (not
      // booleans) matter here: if the hero pill mounted 3 metric tiles
      // into the baseline, the at-risk pill must mount at least one
      // MORE (current > baseline) to count as newly mounting that
      // testid. The previous `!baseline[k]` form treated any non-zero
      // baseline as "already there forever" and would falsely report
      // "not newly mounted" even when current grew.
      //
      // `.every()` (not `.some()`) — the gate's contract is that EVERY
      // expected testid newly mounted for this pill, matching the
      // per-pill prose. `minCounts` separately enforces a delta floor,
      // but stating the conjunctive invariant here makes the contract
      // explicit and future-proof against minCounts regressions.
      const everyNewlyMounted = expectedKeys.every(
        (k) => last[k] > (baselineRef.testIds[k] ?? 0),
      );
      // minCounts asserts how many NEW copies of the testid this pill
      // mounted. Checking absolute counts (`last[key] >= min`) would
      // pass on leftover renders from earlier pills — e.g. at-risk
      // requires `metric: 3` but the hero already painted 3 metric
      // tiles, so absolute-count gating passes even when at-risk
      // mounted zero new metrics. Delta gating (`current - baseline
      // >= min`) requires the pill itself to mount the required
      // count.
      const countsMet = minCountKeys.every(
        ({ key, min }) => last[key] - (baselineRef.testIds[key] ?? 0) >= min,
      );
      if (allPresent && everyNewlyMounted && countsMet) return;
      await new Promise((r) => setTimeout(r, 300));
    }
    const missing = expectedKeys
      .filter((k) => last[k] === 0)
      .map((k) => `${k}=false`);
    const leftoverOnly = expectedKeys
      .filter((k) => last[k] > 0 && last[k] <= (baselineRef.testIds[k] ?? 0))
      .map((k) => `${k}=leftover`);
    const undercounted = minCountKeys
      .filter(
        ({ key, min }) => last[key] - (baselineRef.testIds[key] ?? 0) < min,
      )
      .map(
        ({ key, min }) =>
          `${key}=delta(${last[key]}-${baselineRef.testIds[key] ?? 0})<${min}`,
      );
    throw new Error(
      `gen-ui-declarative-${pillTag}: pill did not produce all expected testids ` +
        `[${expectedTestIds.join(", ")}] within ${FIRST_SIGNAL_TIMEOUT_MS}ms ` +
        `(missing: [${missing.join(", ")}]; leftover-only: [${leftoverOnly.join(", ")}]; ` +
        `undercounted: [${undercounted.join(", ")}])`,
    );
  };
}

/** Per-turn response budget. Must be >= the e2e suite's 90s budget so
 *  the probe doesn't time out before the equivalent Playwright spec
 *  would have. The shared `FIRST_SIGNAL_TIMEOUT_MS` (60s) only covers
 *  the post-send DOM-settle window; the response itself can take
 *  longer on cold starts (Next.js hydrate + agent rehydrate +
 *  secondary-LLM `generate_a2ui` pass). */
const DECLARATIVE_RESPONSE_TIMEOUT_MS = FIRST_SIGNAL_TIMEOUT_MS + 30_000;

export function buildTurns(_ctx: D5BuildContext): ConversationTurn[] {
  return GEN_UI_DECLARATIVE_PILLS.map((pill) => {
    const { tag, prompt, expectedTestIds } = pill;
    const minCounts = (pill as { minCounts?: Record<string, number> })
      .minCounts;
    const baselineRef: DeclarativeBaselineRef = {
      testIds: {
        card: 0,
        metric: 0,
        statusBadge: 0,
        pieChart: 0,
        barChart: 0,
        dataTable: 0,
        infoRow: 0,
      },
      captured: false,
    };
    // Surface-mount completion: this demo wires `a2ui.injectA2UITool: true`,
    // so the agent's response is a secondary `render_a2ui` call that paints
    // the declarative dashboard — NO assistant text bubble is ever emitted.
    // The conversation runner's default text-stability settle can therefore
    // never converge for this turn and would time out as `text-unstable`
    // BEFORE the per-pill `assertions` (the real render-mount check) ever
    // runs. Opting into `completeOnMount` swaps the runner's third settle
    // conjunct from "assistant text stabilised" to "the expected render
    // surface mounted", so the turn completes on `run-finished + new bubble +
    // surface painted` and the assertion gets to verify the catalog testids.
    //
    // The surface testids are the union of the pill's conjunctive
    // `expectedTestIds` and any `minCounts` keys (the full set the assertion
    // checks), so the runner-level gate and the assertion agree on what
    // "mounted" means. The runner's delta gate (`minNewMounts: 1`) only needs
    // to confirm SOMETHING painted for THIS turn — the assertion still
    // enforces the strict per-pill composition + per-testid `minCounts`
    // deltas, so this does not weaken the genuine render check.
    const surfaceTestIds = Array.from(
      new Set<string>([
        ...expectedTestIds,
        ...(minCounts ? Object.keys(minCounts) : []),
      ]),
    );
    return {
      input: prompt,
      action: {
        kind: "pill",
        id: `gen-ui-declarative:${tag}`,
        buttonName: pill.buttonName,
        expectedDispatchedPrompt: prompt,
        submission: { kind: "immediate" },
      },
      preFill: async (page) => {
        await assertCanonicalPillInventory(page);
        await buildBaselineCapture(baselineRef)(page);
      },
      assertions: async (page) => {
        await buildDeclarativeAssertion(
          tag,
          expectedTestIds,
          baselineRef,
          minCounts,
        )(page);
        await assertCanonicalVisibleValues(page, tag, baselineRef.testIds);
      },
      responseTimeoutMs: DECLARATIVE_RESPONSE_TIMEOUT_MS,
      completeOnMount: {
        testIds: surfaceTestIds,
        minNewMounts: 1,
      },
    };
  });
}

registerD5Script({
  featureTypes: ["gen-ui-declarative"],
  fixtureFile: "gen-ui-declarative.json",
  buildTurns,
  preNavigateRoute,
});
