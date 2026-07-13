/**
 * No-divergence test (spec §10.1) — THE load-bearing proof for the D0-gone
 * monitor.
 *
 * The property under test is "the monitor's column-gone verdict is a fold over
 * the SAME `buildCellModel` outputs the dashboard renders" — NOT `f(x) === f(x)`.
 * It has teeth because the RED side uses an OBVIOUSLY-WRONG rule (`naiveGone`:
 * `achievedDepth === 0` alone, ignoring color/staleness) that the real
 * predicate must BEAT on committed fixtures: `naiveGone` mislabels a gray-D0
 * no-data column AND a stale column as "gone", while the real `columnGone`
 * fires ONLY on the red-D0-fresh column.
 *
 * `naiveGone` is a TEST-ONLY frozen reference helper documented as an
 * anti-example — never imported by product code — so the RED stays CI-runnable
 * against committed fixtures forever (not against deleted design code).
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildCellModel } from "../../shared/cell-model/cell-model.js";
import type { CellModelInput } from "../../shared/cell-model/cell-model.js";
import type { StatusRow, State } from "../../shared/cell-model/live-status.js";
import {
  keyFor,
  mergeRowsToMap,
  CATALOG_TO_D5_KEY,
} from "../../shared/cell-model/live-status.js";
import { E2E_STALE_AFTER_MS } from "../../shared/cell-model/staleness.js";
import {
  cellGone,
  columnGone,
  columnFreshHealthy,
  wiredSupportedCells,
} from "./d0-gone-predicate.js";
import type { CellGoneInput } from "./d0-gone-predicate.js";

const NOW = Date.parse("2026-07-13T12:00:00.000Z");
const FRESH = new Date(NOW - 60_000).toISOString();
const STALE = new Date(NOW - E2E_STALE_AFTER_MS - 60_000).toISOString();
const SLUG = "acme";
/** Multi-key D5 family (fans out to per-pill d5/d6 literals). */
const FEATURE = "beautiful-chat";

function row(
  key: string,
  state: State,
  opts: { observedAt?: string; signal?: unknown } = {},
): StatusRow {
  const observed = opts.observedAt ?? FRESH;
  const [dimension = ""] = key.split(":");
  return {
    id: `id-${key}`,
    key,
    dimension,
    state,
    signal: opts.signal ?? null,
    observed_at: observed,
    transitioned_at: observed,
    fail_count: state === "red" ? 1 : 0,
    first_failure_at: state === "red" ? observed : null,
  };
}

function wired(featureId: string): CellModelInput {
  return { slug: SLUG, featureId, isSupported: true, isWired: true };
}

function greenLadder(featureId: string, observedAt: string): StatusRow[] {
  const rows: StatusRow[] = [
    row(keyFor("e2e", SLUG, featureId), "green", { observedAt }),
    row(keyFor("chat", SLUG), "green", { observedAt }),
    row(keyFor("tools", SLUG), "green", { observedAt }),
  ];
  for (const ft of CATALOG_TO_D5_KEY[featureId] ?? []) {
    rows.push(row(keyFor("d5", SLUG, ft), "green", { observedAt }));
    rows.push(row(keyFor("d6", SLUG, ft), "green", { observedAt }));
  }
  return rows;
}

/**
 * TEST-ONLY FROZEN ANTI-EXAMPLE. This is the OBVIOUSLY-WRONG rule the field
 * conflation causes: it looks at `achievedDepth === 0` ALONE, ignoring color
 * and staleness. It mislabels a gray-D0 no-data column and a stale column as
 * "gone." NEVER import this from product code — it exists solely to keep the
 * §10.1 RED runnable against committed fixtures. The real predicate
 * (`columnGone` over `cellGone`) must BEAT it.
 */
function naiveGone(cells: readonly CellGoneInput[]): boolean {
  if (cells.length === 0) return false;
  return cells.every((c) => c.achievedDepth === 0);
}

/**
 * The committed fixture columns. Each is a `LiveStatusMap` + the wired cell
 * inputs to evaluate. `expectedGone` is the DESIGN verdict the real predicate
 * must produce.
 */
interface ColumnFixture {
  name: string;
  live: ReturnType<typeof mergeRowsToMap>;
  inputs: CellModelInput[];
  expectedGone: boolean;
  /** Naive rule mislabels this column (used to prove the RED has teeth). */
  naiveMislabels: boolean;
}

const FIXTURES: ColumnFixture[] = [
  {
    // red-D0 whole column: every wired cell's e2e (and D4 chat/tools) rows are
    // red, fresh → the backend-gone signature the monitor pages on.
    name: "red-d0-fresh",
    live: mergeRowsToMap([
      row(keyFor("e2e", SLUG, FEATURE), "red"),
      row(keyFor("chat", SLUG), "red"),
      row(keyFor("tools", SLUG), "red"),
    ]),
    inputs: [wired(FEATURE)],
    expectedGone: true,
    naiveMislabels: false,
  },
  {
    // gray-D0 no-data column: NO rows at all → gray-D0. naiveGone (depth===0
    // alone) WRONGLY calls this gone; the real predicate does NOT (chipColor is
    // gray, not red).
    name: "gray-d0-no-data",
    live: mergeRowsToMap([]),
    inputs: [wired(FEATURE)],
    expectedGone: false,
    naiveMislabels: true,
  },
  {
    // stale column: a full green ladder aged past the e2e window → the U8
    // matrix-staleness fold collapses the chip to gray AND achievedDepth to 0.
    // naiveGone WRONGLY calls this gone; the real predicate does NOT (isStale).
    name: "stale-column",
    live: mergeRowsToMap(greenLadder(FEATURE, STALE)),
    inputs: [wired(FEATURE)],
    expectedGone: false,
    naiveMislabels: true,
  },
  {
    // mixed: one wired cell red-D0-fresh, a sibling wired cell all-green →
    // NOT every cell gone → columnGone false (per-cell reporting, not an
    // outage).
    name: "mixed-green-red",
    live: mergeRowsToMap([
      // agentic-chat: green ladder
      ...greenLadder("agentic-chat", FRESH),
      // NOTE agentic-chat green + beautiful-chat red share slug-scoped chat/
      // tools rows; keep them green (agentic-chat's) so beautiful-chat's D0 is
      // driven by its own e2e red.
      row(keyFor("e2e", SLUG, FEATURE), "red"),
    ]),
    inputs: [wired("agentic-chat"), wired(FEATURE)],
    expectedGone: false,
    naiveMislabels: false,
  },
  {
    // all-green column: full green ladder, fresh.
    name: "all-green",
    live: mergeRowsToMap(greenLadder(FEATURE, FRESH)),
    inputs: [wired(FEATURE)],
    expectedGone: false,
    naiveMislabels: false,
  },
  {
    // unsupported/unshipped column: isSupported false → the UNSUPPORTED
    // singleton (achievedDepth 0, chipColor gray). Excluded from
    // wiredSupportedCells in the real monitor; here we prove even if evaluated
    // it does NOT page (the DOM-scrape mislabel trap).
    name: "unsupported",
    live: mergeRowsToMap([]),
    inputs: [
      { slug: SLUG, featureId: FEATURE, isSupported: false, isWired: false },
    ],
    expectedGone: false,
    naiveMislabels: false,
  },
];

function modelsFor(fx: ColumnFixture): CellGoneInput[] {
  return fx.inputs.map((input) => {
    const m = buildCellModel(fx.live, input, NOW);
    return {
      achievedDepth: m.achievedDepth,
      chipColor: m.chipColor,
      isStaleCell: m.isStaleCell,
      surfaceState: m.surfaceState,
    };
  });
}

describe("d0-gone-predicate — no divergence from buildCellModel (§10.1)", () => {
  it("RED: the frozen naiveGone anti-example mislabels gray-D0 and stale columns as gone", () => {
    // The teeth: a depth-only rule cannot distinguish backend-gone red-D0 from
    // no-data gray-D0 or stale-collapsed-D0. Prove it mislabels EXACTLY the
    // gray-D0 and stale fixtures.
    const gray = FIXTURES.find((f) => f.name === "gray-d0-no-data")!;
    const stale = FIXTURES.find((f) => f.name === "stale-column")!;
    expect(naiveGone(modelsFor(gray))).toBe(true); // WRONG — no data is not gone
    expect(naiveGone(modelsFor(stale))).toBe(true); // WRONG — stale is not gone

    // And every fixture flagged naiveMislabels is indeed a naive false-positive
    // vs the design verdict.
    for (const fx of FIXTURES.filter((f) => f.naiveMislabels)) {
      expect(naiveGone(modelsFor(fx))).toBe(true);
      expect(fx.expectedGone).toBe(false);
    }
  });

  it("GREEN: the real columnGone predicate fires ONLY on the red-D0-fresh column", () => {
    for (const fx of FIXTURES) {
      expect(columnGone(modelsFor(fx))).toBe(fx.expectedGone);
    }
  });

  it("GREEN: columnGone's per-cell inputs equal buildCellModel's own outputs (same fold, no re-derivation)", () => {
    // The property: the fields the predicate reads (achievedDepth, chipColor,
    // isStaleCell, surfaceState) ARE the values buildCellModel produces — the
    // monitor folds the SAME CellModel the dashboard's DepthChip renders.
    for (const fx of FIXTURES) {
      fx.inputs.forEach((input, i) => {
        const m = buildCellModel(fx.live, input, NOW);
        const folded = modelsFor(fx)[i];
        expect(folded).toEqual({
          achievedDepth: m.achievedDepth,
          chipColor: m.chipColor,
          isStaleCell: m.isStaleCell,
          surfaceState: m.surfaceState,
        });
        // cellGone is exactly the boolean of those fields — no hidden state.
        expect(cellGone(folded)).toBe(
          m.achievedDepth === 0 &&
            m.chipColor === "red" &&
            !m.isStaleCell &&
            m.surfaceState !== "unreachable" &&
            m.surfaceState !== "pending",
        );
      });
    }
  });

  it("columnFreshHealthy is positive evidence: true only for a fresh non-gone column", () => {
    const green = FIXTURES.find((f) => f.name === "all-green")!;
    const red = FIXTURES.find((f) => f.name === "red-d0-fresh")!;
    const stale = FIXTURES.find((f) => f.name === "stale-column")!;
    expect(columnFreshHealthy(modelsFor(green))).toBe(true);
    // gone column is not fresh-healthy
    expect(columnFreshHealthy(modelsFor(red))).toBe(false);
    // stale column is inconclusive — neither gone NOR fresh-healthy
    expect(columnGone(modelsFor(stale))).toBe(false);
    expect(columnFreshHealthy(modelsFor(stale))).toBe(false);
  });
});

describe("wiredSupportedCells — matches the generator's determineCellStatus rule", () => {
  it("keeps wired (feature listed + demo with route), drops unsupported/unshipped/docs-only", () => {
    const registry = {
      feature_registry: {
        features: [
          { id: "agentic-chat" },
          { id: "frontend-tools" },
          { id: "cli-start", kind: "docs-only" }, // docs-only excluded
          { id: "never-shipped" },
        ],
      },
      integrations: [
        {
          slug: "acme",
          features: ["agentic-chat", "frontend-tools"],
          not_supported_features: ["frontend-tools"], // unsupported → dropped
          demos: [
            { id: "agentic-chat", route: "/demos/agentic-chat" },
            { id: "frontend-tools", route: "/demos/frontend-tools" },
          ],
        },
        {
          slug: "beta",
          features: ["agentic-chat"],
          demos: [{ id: "agentic-chat" }], // no route → unshipped/stub → dropped
        },
        {
          slug: "empty",
          features: [],
          demos: [],
        },
      ],
    };
    const cells = wiredSupportedCells(registry);
    expect(cells.get("acme")).toEqual([
      { slug: "acme", featureId: "agentic-chat" },
    ]);
    // beta's only demo has no route → not wired
    expect(cells.get("beta")).toEqual([]);
    // empty slug present with empty array (fails safe in columnGone)
    expect(cells.get("empty")).toEqual([]);
  });

  it("resolves the real generated registry.json to a non-empty wired universe", () => {
    // Ground the enumeration against the actual generated registry the harness
    // ships — proves the shape assumptions hold on real data.
    const here = fileURLToPath(new URL(".", import.meta.url));
    const registryPath = join(here, "../../../../shell/src/data/registry.json");
    const registry = JSON.parse(readFileSync(registryPath, "utf-8"));
    const cells = wiredSupportedCells(registry);
    expect(cells.size).toBeGreaterThan(0);
    const lgp = cells.get("langgraph-python");
    expect(lgp).toBeDefined();
    expect((lgp ?? []).length).toBeGreaterThan(0);
    // langgraph-python declares agentic-chat wired with a route.
    expect((lgp ?? []).some((c) => c.featureId === "agentic-chat")).toBe(true);
  });
});
