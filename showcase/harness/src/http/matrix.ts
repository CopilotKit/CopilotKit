/**
 * `GET /api/matrix` — the read-model that returns the TRUE per-cell chip state
 * as JSON (spec §11).
 *
 * The dashboard chip color is computed in the browser by `buildCellModel` over
 * PocketBase `status` rows, and that computed color diverges from what any raw
 * query returns (a `/api/runs` roll-up, a direct `status` read, or a single
 * row's `state`). So historically the ONLY trustworthy "is this cell
 * red/amber/green/gray" signal was a screenshot. Now that `buildCellModel` is
 * ONE pure total function of `(live, input, now)` (§2), running the SAME engine
 * server-side yields the exact rendered chip state as JSON — no second
 * derivation, no drift (§11.4).
 *
 * The handler:
 *   1. reads the current PB `status` rows via `deps.pb` — WITH the full
 *      `signal` blob on every row (the server has it; the browser's bulk
 *      initial fetch strips it, §11.1(2)), so the infra classifier resolves
 *      with `signalKnown === true` and never hits the cold-load gray fallback;
 *   2. enumerates every catalog cell by RE-FLATTENING the committed
 *      `shared/feature-registry.json` + manifests via `buildCatalogCells` (the
 *      single flattening authority — NOT the dashboard's generated
 *      `catalog.json`); and
 *   3. projects each cell through the pure `computeMatrix` (which funnels
 *      through the shared `catalogCellToInput` → `buildCellModel` — the render's
 *      exact pipeline).
 *
 * It is a pure read model: no writes, no scheduler/PB side-effects (§11.8), and
 * it imports the ONE `staleness.ts` the engine imports, so its windows can
 * never drift from the render's.
 */
import type { Hono } from "hono";
import { compress } from "hono/compress";
import type { PbClient } from "../storage/pb-client.js";
import type { Logger } from "../types/index.js";
import type { StatusRow } from "../shared/cell-model/live-status.js";
import { mergeRowsToMap } from "../shared/cell-model/live-status.js";
import {
  E2E_STALE_AFTER_MS,
  D4_STALE_AFTER_MS,
  LIVENESS_STALE_AFTER_MS,
  STARTER_STALE_AFTER_MS,
  FUTURE_SKEW_TOLERANCE_MS,
} from "../shared/cell-model/staleness.js";
import { buildCatalogCells } from "../shared/catalog/catalog-flatten.js";
import type { CatalogCell } from "../shared/catalog/catalog-flatten.js";
import { computeMatrix } from "./matrix-compute.js";
import type { MatrixCell } from "./matrix-compute.js";

export interface MatrixRouteDeps {
  /** PocketBase handle — lives on `ServerDeps`, threaded explicitly (§11.1(3)). */
  pb: PbClient;
  logger: Logger;
  /** Clock injection for tests; defaults to `Date.now`. */
  now?: () => number;
  /**
   * Catalog cell enumerator. Defaults to the committed-source re-flatten
   * (`buildCatalogCells`). Injectable so tests drive the route off a fixed cell
   * set without touching disk.
   */
  loadCells?: () => CatalogCell[];
}

/** PB `status` pagination bounds (mirrors the d0-gone monitor's full read). */
const STATUS_PAGE_SIZE = 500;
const MAX_STATUS_PAGES = 200;

/**
 * The staleness/future-skew windows the engine folds with, echoed at the top
 * level of the response so a consumer can reproduce the reasoning (§11.3/§11.8).
 */
const WINDOWS = {
  e2eStaleAfterMs: E2E_STALE_AFTER_MS,
  d4StaleAfterMs: D4_STALE_AFTER_MS,
  livenessStaleAfterMs: LIVENESS_STALE_AFTER_MS,
  starterStaleAfterMs: STARTER_STALE_AFTER_MS,
  futureSkewToleranceMs: FUTURE_SKEW_TOLERANCE_MS,
} as const;

export interface MatrixResponse {
  /** The timestamp the folds used (server clock or the `now` query param). */
  now: number;
  windows: typeof WINDOWS;
  cells: MatrixCell[];
  /** Present only on a degraded read (mirrors /api/runs' HTTP-200 posture). */
  error?: "matrix_unavailable";
}

/**
 * Register `GET /api/matrix` on the harness Hono app. A NEW read-only surface —
 * it does not touch `/api/runs`, the producer contract, the PB row shape, or
 * `keyFor`/`CATALOG_TO_D5_KEY` (§8); it is strictly additive. Same
 * auth/exposure posture as `/api/runs` (§11.7): same server, no mutating route.
 */
export function registerMatrixRoute(app: Hono, deps: MatrixRouteDeps): void {
  const nowFn = deps.now ?? (() => Date.now());
  const loadCells = deps.loadCells ?? buildCatalogCells;

  // The cell grid is static per deploy (it derives from the committed
  // feature-registry + manifests), so enumerate once and memoise rather than
  // re-flattening on every request.
  let cachedCells: CatalogCell[] | null = null;
  function cells(): CatalogCell[] {
    if (cachedCells === null) cachedCells = loadCells();
    return cachedCells;
  }

  /**
   * Read ALL `status` rows, WITH the full `signal` blob (the comm-error /
   * infra-class classifier reads `row.signal` per cell), paginating fully.
   */
  async function readStatusRows(): Promise<StatusRow[]> {
    const rows: StatusRow[] = [];
    // With `skipTotal: false`, PB returns an AUTHORITATIVE `totalItems`/
    // `totalPages`. A read is short ONLY when we accumulate fewer rows than the
    // reported `totalItems` (checked after the loop) OR a NON-final page comes
    // back incomplete (< perPage). A FULL final page at `page === totalPages` is
    // the NORMAL terminal state for an exact multiple of the page size (500,
    // 1000, …) — NOT a truncated read. The previous heuristic treated any full
    // final page as truncation and THREW, taking `/api/matrix` down on every
    // request whenever the row count sat on a 500-boundary (a reproducible
    // false outage).
    let reportedTotal: number | null = null;
    for (let page = 1; page <= MAX_STATUS_PAGES; page++) {
      const res = await deps.pb.list<StatusRow>("status", {
        page,
        perPage: STATUS_PAGE_SIZE,
        skipTotal: false,
      });
      rows.push(...res.items);
      // Capture the AUTHORITATIVE `totalItems` BEFORE the empty-page break. An
      // empty FIRST page that PB nonetheless reports a positive `totalItems` for
      // (a transient/inconsistent read) must still trip the post-loop
      // short-read guard — if we broke first, `reportedTotal` would stay null,
      // the guard would be skipped, and the route would serve `cells:[]` as a
      // normal 200: a silent all-gray "complete" matrix (drift, §11.4).
      const totalItems = Number(res.totalItems);
      if (Number.isFinite(totalItems)) reportedTotal = totalItems;
      if (res.items.length === 0) break;
      const totalPages = Number(res.totalPages);
      const isFinalPage = Number.isFinite(totalPages) && page >= totalPages;
      // A NON-final page that came back SHORT (< perPage) is a genuine
      // truncation — PB says more pages follow yet returned an incomplete page.
      // This read model folds rows straight into chip colors, so a dropped row
      // silently flips a cell's verdict. Fail LOUD (log + THROW) → the route's
      // catch degrades to `matrix_unavailable` rather than serving partial
      // chips.
      if (!isFinalPage && res.items.length < STATUS_PAGE_SIZE) {
        deps.logger.error("matrix.status-short-read", {
          errorId: "matrix-status-short-read",
          page,
          totalPages: res.totalPages,
          totalItems: res.totalItems,
          perPage: STATUS_PAGE_SIZE,
          lastPageItems: res.items.length,
          rowsSoFar: rows.length,
        });
        throw new Error(
          "matrix: status read truncated (short page before totalPages) — refusing to serve partial chips",
        );
      }
      if (isFinalPage) break;
      if (page === MAX_STATUS_PAGES) {
        // Page cap hit while PB still reports more pages: the read IS truncated.
        // Unlike the d0-gone monitor (which tolerates + logs), the matrix read
        // model must fail LOUD (THROW, not just log) — serving hundreds of
        // dropped pages as a "complete" matrix is the more severe silent
        // truncation. THROW → route degrades to `matrix_unavailable`.
        deps.logger.error("matrix.status-page-cap-hit", {
          errorId: "matrix-status-page-cap",
          page,
          maxPages: MAX_STATUS_PAGES,
          totalPages: res.totalPages,
          totalItems: res.totalItems,
          rowsSoFar: rows.length,
        });
        throw new Error(
          "matrix: status read hit page cap before totalPages — refusing to serve partial chips",
        );
      }
    }
    // Authoritative-total short-read guard: `totalItems` is authoritative under
    // `skipTotal: false`, so accumulating FEWER rows than it reports means the
    // read was truncated (a full exact-multiple final page is NOT short —
    // `rows.length === totalItems`). Fail LOUD so a dropped page never poisons
    // chip colors.
    if (reportedTotal !== null && rows.length < reportedTotal) {
      deps.logger.error("matrix.status-short-read", {
        errorId: "matrix-status-short-read",
        perPage: STATUS_PAGE_SIZE,
        reportedTotal,
        rowsRead: rows.length,
      });
      throw new Error(
        "matrix: status read truncated (fewer rows than totalItems) — refusing to serve partial chips",
      );
    }
    return rows;
  }

  // gzip the (low-hundreds-of-KB) matrix body when the client accepts it
  // (§11.5). `compress()` no-ops without `Accept-Encoding: gzip`, so test
  // clients (and manual curl) still read plain JSON.
  app.use("/api/matrix", compress());

  app.get("/api/matrix", async (c) => {
    c.header("Cache-Control", "no-cache");
    const nowParam = c.req.query("now");
    const now =
      nowParam !== undefined && /^\d+$/.test(nowParam)
        ? Number(nowParam)
        : nowFn();
    const slugFilter = c.req.query("slug");
    const featureFilter = c.req.query("feature");

    try {
      const rows = await readStatusRows();
      const live = mergeRowsToMap(rows);
      let grid = cells();
      if (slugFilter !== undefined) {
        grid = grid.filter((cell) => cell.integration === slugFilter);
      }
      if (featureFilter !== undefined) {
        grid = grid.filter((cell) => cell.feature === featureFilter);
      }
      const matrix: MatrixCell[] = computeMatrix(
        live,
        grid,
        now,
        // §E: a per-cell model build that throws (e.g. a catalog featureId
        // carrying `:`/`/` that makes `keyFor` throw) degrades to a single gray
        // cell instead of taking the whole surface to `matrix_unavailable`. Log
        // the malformed cell loudly so the latent bad id is greppable.
        (cell, err) => {
          deps.logger.error("matrix.cell-degraded", {
            errorId: "matrix-cell-degraded",
            slug: cell.integration,
            featureId: cell.feature,
            error: String(err),
          });
        },
      );
      const body: MatrixResponse = { now, windows: WINDOWS, cells: matrix };
      return c.json(body);
    } catch (err) {
      // Mirror /api/runs' HTTP-200-on-degraded posture: never 500 the
      // monitoring surface. A read failure yields an empty matrix + an
      // explicit error marker so a consumer distinguishes "no cells" from
      // "couldn't read".
      deps.logger.error("matrix.unavailable", {
        errorId: "matrix-unavailable",
        error: String(err),
      });
      const body: MatrixResponse = {
        now,
        windows: WINDOWS,
        cells: [],
        error: "matrix_unavailable",
      };
      return c.json(body);
    }
  });
}
