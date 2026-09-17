/**
 * Phase 1d STRUCTURAL gate — the starter block is ONE row, and the flag decides.
 *
 * `starter-cell.test.tsx` gates what a single cell draws. This gates the thing
 * that phase is actually FOR: that the four fixed sub-rows
 * (Health/Agent/Chat/Interaction) collapse to a single `starter-row-ladder`,
 * and that the collapse is driven by the CATALOG — the observable effect of
 * `SHOWCASE_STARTER_CELLS` — rather than by a second, independently-drifting
 * read of the flag.
 *
 * Mounting `FeatureGrid` (not a stub) is deliberate: the branch lives inside
 * `StarterSection`, which is not exported, and a test against a re-implemented
 * copy of the branch would prove nothing about the page.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { render, screen } from "@testing-library/react";
import { FeatureGrid } from "@/components/feature-grid";
import { getIntegrations } from "@/lib/registry";
import { mergeRowsToMap, keyFor } from "@/lib/live-status";
import type { StatusRow } from "@/lib/live-status";
import type { CatalogCell, CatalogData } from "@/data/catalog-types";

// `FeatureGrid` resolves the shell host through the client runtime config,
// which the root layout injects. Mounting the component outside the layout
// means injecting it here; nothing in this file depends on its values.
type ConfigWindow = { __SHOWCASE_CONFIG__?: unknown };
const win = globalThis.window as unknown as ConfigWindow;
let hadConfig = false;
let prevConfig: unknown;
beforeAll(() => {
  hadConfig = "__SHOWCASE_CONFIG__" in win;
  prevConfig = win.__SHOWCASE_CONFIG__;
  win.__SHOWCASE_CONFIG__ = {
    pocketbaseUrl: "http://localhost:8090",
    shellUrl: "http://localhost:3000",
    opsBaseUrl: "",
  };
});
afterAll(() => {
  if (hadConfig) win.__SHOWCASE_CONFIG__ = prevConfig;
  else delete win.__SHOWCASE_CONFIG__;
});

const NOW = Date.parse("2026-06-04T12:00:00.000Z");
const FRESH = new Date(NOW - 60_000).toISOString();
const TRIO = "langgraph-python";

const METADATA: CatalogData["metadata"] = {
  reference: "langgraph-python",
  total_cells: 0,
  wired: 0,
  stub: 0,
  unshipped: 0,
  unsupported: 0,
  docs_only: 0,
  generated_at: FRESH,
};

/** An ordinary FEATURE cell — what the other 1029 catalog entries are.
 *  Present in BOTH fixtures because a real catalog is overwhelmingly these:
 *  without them, dropping the `manifestation === "starter"` filter that builds
 *  `starterCells` would be unobservable. */
function featureCell(slug: string, name: string): CatalogCell {
  return {
    id: `${slug}/use-copilot-action`,
    manifestation: "integrated",
    integration: slug,
    integration_name: name,
    feature: "use-copilot-action",
    feature_name: "useCopilotAction",
    category: "dev-ex",
    category_name: "Dev Ex",
    status: "wired",
    parity_tier: "at_parity",
    max_depth: 6,
  };
}

/** Exactly what Step 5 of `catalog-flatten` mints, per column. */
function starterCell(slug: string, name: string): CatalogCell {
  return {
    id: `starter/${slug}`,
    manifestation: "starter",
    integration: slug,
    integration_name: name,
    feature: null,
    feature_name: null,
    category: null,
    category_name: null,
    status: "wired",
    parity_tier: "at_parity",
    max_depth: 3,
  };
}

const rows: StatusRow[] = ["shell", "runtime", "agentrun"].map((level) => ({
  id: `id-${level}`,
  key: keyFor("starter", TRIO, level),
  dimension: "starter",
  state: level === "shell" ? "green" : "red",
  signal: level === "shell" ? null : { errorClass: "assertion-failed" },
  observed_at: FRESH,
  transitioned_at: FRESH,
  fail_count: level === "shell" ? 0 : 2441,
  first_failure_at: level === "shell" ? null : FRESH,
}));

function mount(catalog: CatalogData) {
  return render(
    <FeatureGrid
      title="Feature Matrix"
      renderCell={() => null}
      liveStatus={mergeRowsToMap(rows)}
      connection="connected"
      now={NOW}
      catalog={catalog}
    />,
  );
}

const LEGACY_ROWS = ["health", "agent", "chat", "interaction"];

describe("the starter block's row shape follows the catalog", () => {
  // MUTATION THAT REDS THIS: delete the `if (ladder)` branch in
  // `StarterSection` (or its `starterCells` prop) so the four legacy sub-rows
  // always render. Observed: this case fails on `getByTestId
  // ("starter-row-ladder")`.
  it("a catalog WITH starter cells draws ONE row, no legacy sub-rows", () => {
    const cells = getIntegrations().flatMap((i) => [
      featureCell(i.slug, i.name),
      starterCell(i.slug, i.name),
    ]);
    mount({ metadata: METADATA, cells });

    expect(screen.getByTestId("starter-row-ladder")).toBeTruthy();
    for (const level of LEGACY_ROWS) {
      expect(screen.queryByTestId(`starter-row-${level}`)).toBeNull();
    }
    // One cell per column, and the trio's cell is the D1 the engine folded.
    const ladder = screen.getByTestId("starter-row-ladder");
    expect(ladder.querySelectorAll("td").length - 1).toBe(
      getIntegrations().length,
    );
    expect(screen.getByTestId(`starter-rungs-${TRIO}`).textContent).toBe(
      "D1 ✓D2 ✗D3 —",
    );
  });

  // TWO MUTATIONS RED THIS, both observed:
  //   (a) remove `if (starterCells.size === 0) return null;` from the `ladder`
  //       memo — the flag-OFF build then draws an EMPTY single row where the
  //       four legacy rows belong, a silent change on the DEFAULT path.
  //   (b) drop the `cell.manifestation === "starter"` filter that builds
  //       `starterCells` — ordinary feature cells then populate the map, so a
  //       flag-off catalog renders the ladder row anyway. This is why both
  //       fixtures carry feature cells: against a starter-only fixture the
  //       filter is unobservable and this gate would be decorative.
  it("a catalog WITHOUT starter cells draws today's four sub-rows, unchanged", () => {
    // A flag-OFF catalog is not EMPTY — it is the same catalog minus Step 5.
    mount({
      metadata: METADATA,
      cells: getIntegrations().map((i) => featureCell(i.slug, i.name)),
    });

    expect(screen.queryByTestId("starter-row-ladder")).toBeNull();
    for (const level of LEGACY_ROWS) {
      expect(screen.getByTestId(`starter-row-${level}`)).toBeTruthy();
    }
  });
});
