import { describe, it, expect, vi, afterEach } from "vitest";
import {
  computeHealthStats,
  computeParityStats,
  computeDepthDistribution,
  computeD6Stats,
} from "../page-stats";
import type { LiveStatusMap, StatusRow, State } from "../live-status";
import { keyFor } from "../live-status";
import type { CatalogCell } from "../../data/catalog-types";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

const FRESH = new Date().toISOString();

function row(
  key: string,
  dimension: string,
  state: State,
  overrides: Partial<StatusRow> = {},
): StatusRow {
  return {
    id: `id-${key}`,
    key,
    dimension,
    state,
    signal: {},
    observed_at: FRESH,
    transitioned_at: FRESH,
    fail_count: state === "red" ? 1 : 0,
    first_failure_at: state === "red" ? FRESH : null,
    ...overrides,
  };
}

function mapOf(rows: StatusRow[]): LiveStatusMap {
  const m: LiveStatusMap = new Map();
  for (const r of rows) m.set(r.key, r);
  return m;
}

function wiredCell(overrides: Partial<CatalogCell> = {}): CatalogCell {
  return {
    id: `${overrides.integration ?? "agno"}/${overrides.feature ?? "agentic-chat"}`,
    manifestation: "integrated",
    integration: "agno",
    integration_name: "Agno",
    feature: "agentic-chat",
    feature_name: "Agentic Chat",
    status: "wired",
    parity_tier: "at_parity",
    max_depth: 4,
    category: null,
    category_name: null,
    ...overrides,
  };
}

/**
 * Build the full set of green rows that drive `(slug, feature)` to
 * achievedDepth === 6: e2e (D3) + chat/tools (D4) + d5 + d6 sub-rows, all
 * green-and-fresh. `agentic-chat` maps to the single d5/d6 key `agentic-chat`.
 */
function fullDepth6Rows(slug: string, feature: string): StatusRow[] {
  return [
    row(keyFor("e2e", slug, feature), "e2e", "green"),
    row(keyFor("chat", slug), "chat", "green"),
    row(keyFor("tools", slug), "tools", "green"),
    row(keyFor("d5", slug, feature), "d5", "green"),
    row(keyFor("d6", slug, feature), "d6", "green"),
  ];
}

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Finding #1 — D6 cells must NOT be dropped from the depth distribution.
// ---------------------------------------------------------------------------

describe("computeDepthDistribution — D6 (Finding #1)", () => {
  it("counts a D6-achieved cell in the d6 bucket (not dropped to NaN)", () => {
    const cell = wiredCell({ integration: "agno", feature: "agentic-chat" });
    const live = mapOf(fullDepth6Rows("agno", "agentic-chat"));
    const now = Date.parse(FRESH);

    const dist = computeDepthDistribution([cell], live, now);

    // The cell reaches achievedDepth 6 → must land in d6, not vanish.
    expect(dist.d6).toBe(1);
    expect(dist.d5).toBe(0);
    expect(dist.d4).toBe(0);
    expect(dist.d3).toBe(0);
    expect(dist.d0).toBe(0);
    // No bucket may be NaN (the old `as keyof` cast produced dist["d6"]++ = NaN).
    for (const v of Object.values(dist)) expect(Number.isNaN(v)).toBe(false);
  });

  it("buckets cells across multiple depths simultaneously", () => {
    const d6Cell = wiredCell({ integration: "agno", feature: "agentic-chat" });
    // A wired cell with no live rows → achievedDepth 0 → d0 bucket.
    const d0Cell = wiredCell({
      integration: "mastra",
      feature: "agentic-chat",
    });
    const live = mapOf(fullDepth6Rows("agno", "agentic-chat"));
    const now = Date.parse(FRESH);

    const dist = computeDepthDistribution([d6Cell, d0Cell], live, now);

    expect(dist.d6).toBe(1);
    expect(dist.d0).toBe(1);
  });

  it("lands a wired-but-unverified cell in d0 and sums to the wired total", () => {
    // Three wired cells: one reaches D6, two have no live data → D0.
    const d6Cell = wiredCell({ integration: "agno", feature: "agentic-chat" });
    const d0CellA = wiredCell({
      integration: "mastra",
      feature: "agentic-chat",
    });
    const d0CellB = wiredCell({
      integration: "crewai",
      feature: "agentic-chat",
    });
    // A non-wired cell must NOT be counted toward the wired total.
    const stub = wiredCell({
      integration: "x",
      feature: "agentic-chat",
      status: "stub",
    });
    const cells = [d6Cell, d0CellA, d0CellB, stub];
    const live = mapOf(fullDepth6Rows("agno", "agentic-chat"));
    const now = Date.parse(FRESH);

    const dist = computeDepthDistribution(cells, live, now);

    // The two no-data wired cells land in d0 (visible, not vanished).
    expect(dist.d0).toBe(2);
    expect(dist.d6).toBe(1);

    // The distribution exposes EXACTLY the reachable buckets — no dead d1/d2
    // keys that buildCellModel().achievedDepth (0|3|4|5|6) can never populate.
    expect(Object.keys(dist).sort()).toEqual(["d0", "d3", "d4", "d5", "d6"]);

    // Every bucket sums to the count of wired cells (3), not including the stub.
    const wiredCount = cells.filter(
      (c) => c.status === "wired" && c.feature !== null,
    ).length;
    const total = Object.values(dist).reduce((a, b) => a + b, 0);
    expect(total).toBe(wiredCount);
    expect(total).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// Finding #2 — d6Stats must surface amber (degraded) distinctly, not as gray.
// ---------------------------------------------------------------------------

describe("computeD6Stats — degraded (Finding #2)", () => {
  it("counts a stale-green D6 cell as degraded, not gray", () => {
    const cell = wiredCell({ integration: "agno", feature: "agentic-chat" });
    // D6 row is green but observed long ago → resolveCell downgrades to amber.
    const stale = new Date(Date.now() - 1000 * 60 * 60 * 24 * 30).toISOString();
    const live = mapOf([
      row(keyFor("d6", "agno", "agentic-chat"), "d6", "green", {
        observed_at: stale,
      }),
    ]);
    const now = Date.now();

    const stats = computeD6Stats([cell], live, now);

    expect(stats.degraded).toBe(1);
    expect(stats.gray).toBe(0);
    expect(stats.green).toBe(0);
    expect(stats.red).toBe(0);
  });

  it("still counts green / red / gray (no row) correctly", () => {
    const greenCell = wiredCell({
      integration: "agno",
      feature: "agentic-chat",
    });
    const redCell = wiredCell({
      integration: "mastra",
      feature: "agentic-chat",
    });
    const grayCell = wiredCell({
      integration: "agno",
      feature: "tool-rendering",
    });
    const live = mapOf([
      row(keyFor("d6", "agno", "agentic-chat"), "d6", "green"),
      row(keyFor("d6", "mastra", "agentic-chat"), "d6", "red"),
      // grayCell: no d6 row for tool-rendering → gray.
    ]);
    const now = Date.now();

    const stats = computeD6Stats([greenCell, redCell, grayCell], live, now);

    expect(stats.green).toBe(1);
    expect(stats.red).toBe(1);
    expect(stats.gray).toBe(1);
    expect(stats.degraded).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Finding #3 — healthStats must NOT fold gray (no-data) into green.
// ---------------------------------------------------------------------------

describe("computeHealthStats — gray is no-data, not green (Finding #3)", () => {
  it("counts a no-data wired cell as noData, not green", () => {
    const cell = wiredCell({ integration: "agno", feature: "agentic-chat" });
    // No live rows → buildCellModel chipColor gray.
    const live = mapOf([]);
    const now = Date.now();

    const stats = computeHealthStats([cell], live, now);

    expect(stats.noData).toBe(1);
    expect(stats.green).toBe(0);
    expect(stats.amber).toBe(0);
    expect(stats.red).toBe(0);
  });

  it("counts a genuinely green cell as green", () => {
    const cell = wiredCell({ integration: "agno", feature: "agentic-chat" });
    const live = mapOf(fullDepth6Rows("agno", "agentic-chat"));
    const now = Date.parse(FRESH);

    const stats = computeHealthStats([cell], live, now);

    expect(stats.green).toBe(1);
    expect(stats.noData).toBe(0);
  });

  it("ignores non-wired cells", () => {
    const stub = wiredCell({ status: "stub" });
    const unshipped = wiredCell({ status: "unshipped" });
    const stats = computeHealthStats([stub, unshipped], mapOf([]), Date.now());
    expect(stats).toEqual({ green: 0, amber: 0, red: 0, noData: 0 });
  });
});

// ---------------------------------------------------------------------------
// Finding #5 — parity_tier must be validated before indexing (no NaN).
// ---------------------------------------------------------------------------

describe("computeParityStats — unknown tier (Finding #5)", () => {
  it("counts known tiers per unique integration", () => {
    const cells = [
      wiredCell({ integration: "a", parity_tier: "reference" }),
      wiredCell({ integration: "a", parity_tier: "reference" }), // dup int → ignored
      wiredCell({ integration: "b", parity_tier: "partial" }),
      wiredCell({ integration: "c", parity_tier: "not_wired" }),
    ];
    const counts = computeParityStats(cells);
    expect(counts.reference).toBe(1);
    expect(counts.partial).toBe(1);
    expect(counts.not_wired).toBe(1);
    expect(counts.at_parity).toBe(0);
    expect(counts.minimal).toBe(0);
  });

  it("skips an unknown tier instead of producing NaN, and fails loud", () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const cells = [
      wiredCell({ integration: "good", parity_tier: "minimal" }),
      // Forward-incompatible / corrupt catalog row with an unknown tier.
      wiredCell({
        integration: "bad",
        parity_tier: "totally_unknown" as CatalogCell["parity_tier"],
      }),
    ];

    const counts = computeParityStats(cells);

    expect(counts.minimal).toBe(1);
    // No NaN anywhere — the unknown tier is skipped, not indexed.
    for (const v of Object.values(counts)) expect(Number.isNaN(v)).toBe(false);
    expect(errSpy).toHaveBeenCalledTimes(1);
    expect(errSpy.mock.calls[0][0]).toContain("unknown parity_tier");
  });
});
