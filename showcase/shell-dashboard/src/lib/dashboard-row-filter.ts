import type { CatalogCell, CatalogData } from "@/data/catalog-types";

export const DASHBOARD_ROWS_PARAM = "rows";

export interface DashboardRowFilter {
  active: boolean;
  ids: string[];
  unknownIds: string[];
}

export function parseDashboardRowFilter(
  search: string,
  availableRows: readonly string[],
): DashboardRowFilter {
  const params = new URLSearchParams(
    search.startsWith("?") ? search : `?${search}`,
  );
  const requested = [...params.entries()]
    .filter(
      ([key]) =>
        key === "row" || key === DASHBOARD_ROWS_PARAM || key === "features",
    )
    .map(([, value]) => value)
    .flatMap((value) => value.split(","))
    .map((value) => value.trim())
    .filter(Boolean);

  if (requested.length === 0) {
    return { active: false, ids: [], unknownIds: [] };
  }

  const available = new Set(availableRows);
  const seen = new Set<string>();
  const ids: string[] = [];
  const unknownIds: string[] = [];

  for (const id of requested) {
    if (seen.has(id)) continue;
    seen.add(id);
    if (available.has(id)) {
      ids.push(id);
    } else {
      unknownIds.push(id);
    }
  }

  return { active: true, ids, unknownIds };
}

export function buildDashboardRowsQuery(ids: readonly string[]): string {
  return `${DASHBOARD_ROWS_PARAM}=${ids.map(encodeURIComponent).join(",")}`;
}

function summarizeCells(
  cells: readonly CatalogCell[],
): CatalogData["metadata"] {
  const metadata: CatalogData["metadata"] = {
    reference: "",
    total_cells: cells.length,
    wired: 0,
    stub: 0,
    unshipped: 0,
    unsupported: 0,
    docs_only: 0,
    generated_at: "",
  };

  for (const cell of cells) {
    if (cell.status === "wired") metadata.wired++;
    else if (cell.status === "stub") metadata.stub++;
    else if (cell.status === "unshipped") metadata.unshipped++;
    else if (cell.status === "unsupported") metadata.unsupported++;
  }

  return metadata;
}

export function filterCatalogDataByRows(
  catalog: CatalogData,
  rowFilter: DashboardRowFilter,
): CatalogData {
  if (!rowFilter.active) return catalog;

  const ids = new Set(rowFilter.ids);
  const cells = catalog.cells.filter(
    (cell) => cell.feature !== null && ids.has(cell.feature),
  );

  return {
    ...catalog,
    metadata: {
      ...catalog.metadata,
      ...summarizeCells(cells),
      reference: catalog.metadata.reference,
      generated_at: catalog.metadata.generated_at,
    },
    cells,
  };
}
