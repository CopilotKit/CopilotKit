import { describe, expect, it } from "vitest";
import {
  buildDashboardRowsQuery,
  filterCatalogDataByRows,
  parseDashboardRowFilter,
} from "./dashboard-row-filter";
import type { CatalogData } from "@/data/catalog-types";

describe("dashboard row filter", () => {
  it("parses comma-separated rows, repeated row params, and unknown ids", () => {
    const filter = parseDashboardRowFilter(
      "?rows=alpha,beta&row=gamma&rows=alpha,missing",
      ["alpha", "beta", "gamma"],
    );

    expect(filter).toEqual({
      active: true,
      ids: ["alpha", "beta", "gamma"],
      unknownIds: ["missing"],
    });
  });

  it("is inactive when no row params are present", () => {
    expect(parseDashboardRowFilter("?tab=matrix", ["alpha"])).toEqual({
      active: false,
      ids: [],
      unknownIds: [],
    });
  });

  it("builds the dashboard rows query", () => {
    expect(buildDashboardRowsQuery(["alpha", "beta"])).toBe("rows=alpha,beta");
  });

  it("filters catalog cells and recomputes cell counts", () => {
    const catalog: CatalogData = {
      metadata: {
        reference: "langgraph-python",
        total_cells: 3,
        wired: 1,
        stub: 1,
        unshipped: 1,
        unsupported: 0,
        docs_only: 0,
        generated_at: "2026-06-21T00:00:00.000Z",
      },
      cells: [
        {
          id: "a:i1",
          manifestation: "integrated",
          integration: "i1",
          integration_name: "I1",
          feature: "a",
          feature_name: "A",
          status: "wired",
          parity_tier: "reference",
          max_depth: 6,
          category: "c",
          category_name: "C",
        },
        {
          id: "b:i1",
          manifestation: "integrated",
          integration: "i1",
          integration_name: "I1",
          feature: "b",
          feature_name: "B",
          status: "stub",
          parity_tier: "partial",
          max_depth: 5,
          category: "c",
          category_name: "C",
        },
        {
          id: "starter:i1",
          manifestation: "starter",
          integration: "i1",
          integration_name: "I1",
          feature: null,
          feature_name: null,
          status: "unshipped",
          parity_tier: "not_wired",
          max_depth: 0,
          category: null,
          category_name: null,
        },
      ],
    };

    const filtered = filterCatalogDataByRows(catalog, {
      active: true,
      ids: ["a"],
      unknownIds: [],
    });

    expect(filtered.cells.map((cell) => cell.id)).toEqual(["a:i1"]);
    expect(filtered.metadata).toMatchObject({
      total_cells: 1,
      wired: 1,
      stub: 0,
      unshipped: 0,
      unsupported: 0,
    });
  });
});
