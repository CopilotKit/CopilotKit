import { describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Hono } from "hono";
import type { ListOpts, ListResult, PbClient } from "../storage/pb-client.js";
import type { Logger } from "../types/index.js";
import { keyFor, mergeRowsToMap } from "../shared/cell-model/live-status.js";
import type { StatusRow, State } from "../shared/cell-model/live-status.js";
import { buildCellModel } from "../shared/cell-model/cell-model.js";
import { catalogCellToInput } from "../shared/cell-model/catalog-input.js";
import { E2E_STALE_AFTER_MS } from "../shared/cell-model/staleness.js";
import {
  generateCatalog,
  loadIntegrationManifests,
  ManifestValidationError,
  MissingReferenceIntegrationError,
} from "../shared/catalog/catalog-flatten.js";
import type {
  CatalogCell,
  FeatureRegistry,
} from "../shared/catalog/catalog-flatten.js";
import { registerMatrixRoute } from "./matrix.js";
import type { MatrixResponse } from "./matrix.js";
import { computeMatrix } from "./matrix-compute.js";
import type { MatrixCell } from "./matrix-compute.js";

// ── Fixed clock + freshness helpers ────────────────────────────────────────
const NOW = Date.parse("2026-06-04T12:00:00.000Z");
const FRESH = new Date(NOW - 60_000).toISOString();
const STALE = new Date(NOW - E2E_STALE_AFTER_MS - 60_000).toISOString();

const noopLogger: Logger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
};

function row(
  key: string,
  state: State,
  opts: { observedAt?: string; signal?: unknown } = {},
): StatusRow {
  const observed = opts.observedAt ?? FRESH;
  const [dimension = ""] = key.split(":");
  const isRed = state === "red";
  return {
    id: `id-${key}`,
    key,
    dimension,
    state,
    signal: "signal" in opts ? opts.signal : null,
    observed_at: observed,
    transitioned_at: observed,
    fail_count: isRed ? 1 : 0,
    first_failure_at: isRed ? observed : null,
  };
}

/** Full green D3→D4 ladder rows for a cell (e2e + chat + tools). */
function greenLadder(slug: string, feature: string, observedAt: string) {
  return [
    row(keyFor("e2e", slug, feature), "green", { observedAt }),
    row(keyFor("chat", slug), "green", { observedAt }),
    row(keyFor("tools", slug), "green", { observedAt }),
  ];
}

function integratedCell(
  integration: string,
  feature: string,
  status: CatalogCell["status"],
): CatalogCell {
  return {
    id: `${integration}/${feature}`,
    manifestation: "integrated",
    integration,
    integration_name: integration,
    feature,
    feature_name: feature,
    category: null,
    category_name: null,
    status,
    parity_tier: "at_parity",
    max_depth: status === "unshipped" || status === "unsupported" ? 0 : 4,
  };
}

/**
 * A read-only fake PbClient that paginates a fixed `status` row set and THROWS
 * on every mutating method — so a test proves the route never writes (§11.8).
 */
function fakePb(
  rows: StatusRow[],
  opts: { failList?: boolean } = {},
): { pb: PbClient; listCalls: number } {
  const state = { listCalls: 0 };
  const mut = (name: string) => () => {
    throw new Error(`read-only route must not call pb.${name}`);
  };
  const pb: PbClient = {
    async list<T>(
      collection: string,
      listOpts?: ListOpts,
    ): Promise<ListResult<T>> {
      state.listCalls += 1;
      if (opts.failList) throw new Error("pb down");
      expect(collection).toBe("status");
      const page = listOpts?.page ?? 1;
      const perPage = listOpts?.perPage ?? rows.length;
      const start = (page - 1) * perPage;
      const items = rows.slice(start, start + perPage);
      return {
        page,
        perPage,
        totalPages: Math.max(1, Math.ceil(rows.length / perPage)),
        totalItems: rows.length,
        items: items as T[],
      };
    },
    getOne: mut("getOne") as PbClient["getOne"],
    getFirst: mut("getFirst") as PbClient["getFirst"],
    create: mut("create") as PbClient["create"],
    update: mut("update") as PbClient["update"],
    upsertByField: mut("upsertByField") as PbClient["upsertByField"],
    delete: mut("delete") as PbClient["delete"],
    deleteByFilter: mut("deleteByFilter") as PbClient["deleteByFilter"],
    health: mut("health") as PbClient["health"],
    createBackup: mut("createBackup") as PbClient["createBackup"],
    downloadBackup: mut("downloadBackup") as PbClient["downloadBackup"],
    deleteBackup: mut("deleteBackup") as PbClient["deleteBackup"],
  };
  return {
    pb,
    get listCalls() {
      return state.listCalls;
    },
  };
}

/**
 * Build a read-only `PbClient` from a single `list` implementation, with every
 * mutating method throwing (a route that writes fails loud). Lets a test drive
 * the exact pagination shape PB returns without repeating the mutator boilerplate.
 */
function pbWithList(listImpl: PbClient["list"]): PbClient {
  const mut = (name: string) => () => {
    throw new Error(`read-only route must not call pb.${name}`);
  };
  return {
    list: listImpl,
    getOne: mut("getOne") as PbClient["getOne"],
    getFirst: mut("getFirst") as PbClient["getFirst"],
    create: mut("create") as PbClient["create"],
    update: mut("update") as PbClient["update"],
    upsertByField: mut("upsertByField") as PbClient["upsertByField"],
    delete: mut("delete") as PbClient["delete"],
    deleteByFilter: mut("deleteByFilter") as PbClient["deleteByFilter"],
    health: mut("health") as PbClient["health"],
    createBackup: mut("createBackup") as PbClient["createBackup"],
    downloadBackup: mut("downloadBackup") as PbClient["downloadBackup"],
    deleteBackup: mut("deleteBackup") as PbClient["deleteBackup"],
  };
}

function makeApp(opts: {
  rows: StatusRow[];
  cells: CatalogCell[];
  failList?: boolean;
}): { app: Hono; pb: ReturnType<typeof fakePb> } {
  const app = new Hono();
  const pb = fakePb(opts.rows, { failList: opts.failList });
  registerMatrixRoute(app, {
    pb: pb.pb,
    logger: noopLogger,
    now: () => NOW,
    loadCells: () => opts.cells,
  });
  return { app, pb };
}

async function getMatrix(
  app: Hono,
  query = "",
): Promise<{ status: number; body: MatrixResponse }> {
  const res = await app.request(`/api/matrix${query}`);
  const body = (await res.json()) as MatrixResponse;
  return { status: res.status, body };
}

function cellOf(body: MatrixResponse, slug: string, feature: string | null) {
  return body.cells.find((c) => c.slug === slug && c.featureId === feature);
}

describe("GET /api/matrix", () => {
  it("returns 200 with per-cell chip state + top-level now/windows", async () => {
    const cells = [
      integratedCell("acme", "agentic-chat", "wired"),
      integratedCell("acme", "shared-state", "unsupported"),
    ];
    const rows = greenLadder("acme", "agentic-chat", FRESH);
    const { app } = makeApp({ rows, cells });

    const { status, body } = await getMatrix(app);
    expect(status).toBe(200);
    expect(body.now).toBe(NOW);
    expect(body.windows.e2eStaleAfterMs).toBe(E2E_STALE_AFTER_MS);
    expect(body.windows.futureSkewToleranceMs).toBeGreaterThan(0);
    expect(body.cells).toHaveLength(2);

    // Every field is a direct CellModel projection (§11.3).
    const green = cellOf(body, "acme", "agentic-chat")!;
    const expectKeys: Array<keyof MatrixCell> = [
      "slug",
      "featureId",
      "chipColor",
      "achievedDepth",
      "ceilingDepth",
      "d6Effective",
      "isRegression",
      "surfaceState",
      "isStaleCell",
      "supported",
    ];
    for (const k of expectKeys) expect(green).toHaveProperty(k);

    const unsupported = cellOf(body, "acme", "shared-state")!;
    expect(unsupported.supported).toBe(false);
    expect(unsupported.chipColor).toBe("gray");
  });

  it("equals buildCellModel by construction for every cell (api == render)", async () => {
    const cells = [integratedCell("acme", "agentic-chat", "wired")];
    const rows = greenLadder("acme", "agentic-chat", FRESH);
    const { app } = makeApp({ rows, cells });
    const { body } = await getMatrix(app);

    const live = mergeRowsToMap(rows);
    const expected = buildCellModel(live, catalogCellToInput(cells[0]!), NOW);
    const api = cellOf(body, "acme", "agentic-chat")!;
    expect(api.chipColor).toBe(expected.chipColor);
    expect(api.achievedDepth).toBe(expected.achievedDepth);
    expect(api.ceilingDepth).toBe(expected.ceilingDepth);
    expect(api.d6Effective).toBe(expected.d6Effective);
    expect(api.isRegression).toBe(expected.isRegression);
    expect(api.surfaceState).toBe(expected.surfaceState);
    expect(api.isStaleCell).toBe(expected.isStaleCell);
    expect(api.supported).toBe(expected.supported);
  });

  it("?slug and ?feature narrow the result", async () => {
    const cells = [
      integratedCell("acme", "agentic-chat", "wired"),
      integratedCell("acme", "human-in-the-loop", "wired"),
      integratedCell("globex", "agentic-chat", "wired"),
    ];
    const { app } = makeApp({ rows: [], cells });

    const bySlug = await getMatrix(app, "?slug=acme");
    expect(bySlug.body.cells.map((c) => c.slug).sort()).toEqual([
      "acme",
      "acme",
    ]);

    const byFeature = await getMatrix(app, "?feature=agentic-chat");
    expect(byFeature.body.cells.map((c) => c.slug).sort()).toEqual([
      "acme",
      "globex",
    ]);

    const both = await getMatrix(app, "?slug=acme&feature=human-in-the-loop");
    expect(both.body.cells).toHaveLength(1);
    expect(both.body.cells[0]!.featureId).toBe("human-in-the-loop");
  });

  it("?now pins the fold clock (threads into buildCellModel, not just echoed)", async () => {
    const pinned = Date.parse("2020-01-01T00:00:00.000Z");
    const cells = [integratedCell("acme", "agentic-chat", "wired")];
    // Rows are FRESH vs the server clock (2026) but ~6y in the FUTURE vs the
    // pinned 2020 clock — beyond FUTURE_SKEW_TOLERANCE. Under the pinned clock
    // every contributing row is future-skewed → treated stale → the cell folds
    // to isStaleCell=true, achievedDepth=0. Under the 2026 server clock the
    // same rows are fresh → isStaleCell=false, achievedDepth=4. If `?now` were
    // merely parsed + echoed into `body.now` (and NOT threaded into
    // buildCellModel's staleness/skew computation), the API cell would carry
    // the server-NOW fold and the assertions below would fail.
    const rows = greenLadder("acme", "agentic-chat", FRESH);
    const { app } = makeApp({ rows, cells });
    const { body } = await getMatrix(app, `?now=${pinned}`);
    expect(body.now).toBe(pinned);

    const api = cellOf(body, "acme", "agentic-chat")!;
    const live = mergeRowsToMap(rows);
    const pinnedFold = buildCellModel(
      live,
      catalogCellToInput(cells[0]!),
      pinned,
    );
    const nowFold = buildCellModel(live, catalogCellToInput(cells[0]!), NOW);

    // The two folds genuinely differ on staleness/depth (guards against a
    // degenerate test where both clocks yield the same fold).
    expect(nowFold.isStaleCell).toBe(false);
    expect(nowFold.achievedDepth).toBe(4);
    expect(pinnedFold.isStaleCell).toBe(true);
    expect(pinnedFold.achievedDepth).toBe(0);

    // The API cell must match the PINNED fold, proving the clock threaded in.
    expect(api.isStaleCell).toBe(pinnedFold.isStaleCell);
    expect(api.achievedDepth).toBe(pinnedFold.achievedDepth);
    expect(api.isStaleCell).not.toBe(nowFold.isStaleCell);
  });

  it("is a pure read model — never writes to PB (§11.8)", async () => {
    const cells = [integratedCell("acme", "agentic-chat", "wired")];
    const rows = greenLadder("acme", "agentic-chat", FRESH);
    const { app, pb } = makeApp({ rows, cells });
    // fakePb throws on every mutating method. Reaching 200 alone is NOT enough:
    // the route swallows a thrown PB call into a 200 `matrix_unavailable`
    // degraded body, so an incidental mutator throw would ALSO surface as 200
    // and false-green this test. Assert the HEALTHY body (no error marker, the
    // green cell present) to prove the read path completed WITHOUT any write.
    const { status, body } = await getMatrix(app);
    expect(status).toBe(200);
    expect(pb.listCalls).toBeGreaterThan(0);
    expect(body.error).toBeUndefined();
    expect(body.cells).toHaveLength(1);
    expect(cellOf(body, "acme", "agentic-chat")).toBeDefined();
  });

  it("holds a 200 degraded posture when the PB read fails (mirrors /api/runs)", async () => {
    const cells = [integratedCell("acme", "agentic-chat", "wired")];
    const { app } = makeApp({ rows: [], cells, failList: true });
    const { status, body } = await getMatrix(app);
    expect(status).toBe(200);
    expect(body.error).toBe("matrix_unavailable");
    expect(body.cells).toEqual([]);
  });

  it("serves the FULL matrix at an exact-multiple-of-500 row count (no false short-read outage)", async () => {
    // With `skipTotal:false`, PB's `totalItems`/`totalPages` are AUTHORITATIVE.
    // When the collection holds exactly N*500 rows the genuine last page is
    // completely full (`items.length === 500`) AND `page === totalPages` — the
    // NORMAL terminal state for an exact multiple, NOT a truncated read. The
    // old heuristic threw here, taking `/api/matrix` down on every request while
    // the row count sat on a 500-boundary. It must now trust the authoritative
    // total and serve the full matrix.
    const PAGE = 500; // == STATUS_PAGE_SIZE in matrix.ts
    const cells = [integratedCell("acme", "agentic-chat", "wired")];
    // A real green ladder for the cell + filler rows padding to EXACTLY 500.
    const ladder = greenLadder("acme", "agentic-chat", FRESH);
    const filler: StatusRow[] = Array.from(
      { length: PAGE - ladder.length },
      (_, i) => row(keyFor("chat", `filler-${i}`), "green"),
    );
    const rows = [...ladder, ...filler];
    expect(rows.length).toBe(PAGE);
    const { app } = makeApp({ rows, cells });
    const { status, body } = await getMatrix(app);
    expect(status).toBe(200);
    expect(body.error).toBeUndefined();
    expect(cellOf(body, "acme", "agentic-chat")).toBeDefined();
  });

  it("fails loud (matrix_unavailable) on a GENUINE short-read (fewer rows than authoritative totalItems)", async () => {
    // A genuine truncation: PB's authoritative `totalItems` reports MORE rows
    // than were actually returned (e.g. a page vanished / an inconsistent
    // count). The read model folds rows straight into chip colors, so a dropped
    // row silently flips a verdict. It must fail LOUD → matrix_unavailable
    // rather than serve partial-poisoned chips.
    const PAGE = 500; // == STATUS_PAGE_SIZE in matrix.ts
    const cells = [integratedCell("acme", "agentic-chat", "wired")];
    const fullPage: StatusRow[] = Array.from({ length: PAGE }, (_, i) =>
      row(keyFor("chat", `slug-${i}`), "green"),
    );
    const throwMut = (name: string) => () => {
      throw new Error(`read-only route must not call pb.${name}`);
    };
    const pb: PbClient = {
      async list<T>(collection: string): Promise<ListResult<T>> {
        expect(collection).toBe("status");
        return {
          page: 1,
          perPage: PAGE,
          totalPages: 1, // claims done…
          totalItems: PAGE + 100, // …but authoritatively reports MORE rows exist
          items: fullPage as unknown as T[], // …while returning only 500
        };
      },
      getOne: throwMut("getOne") as PbClient["getOne"],
      getFirst: throwMut("getFirst") as PbClient["getFirst"],
      create: throwMut("create") as PbClient["create"],
      update: throwMut("update") as PbClient["update"],
      upsertByField: throwMut("upsertByField") as PbClient["upsertByField"],
      delete: throwMut("delete") as PbClient["delete"],
      deleteByFilter: throwMut("deleteByFilter") as PbClient["deleteByFilter"],
      health: throwMut("health") as PbClient["health"],
      createBackup: throwMut("createBackup") as PbClient["createBackup"],
      downloadBackup: throwMut("downloadBackup") as PbClient["downloadBackup"],
      deleteBackup: throwMut("deleteBackup") as PbClient["deleteBackup"],
    };
    const app = new Hono();
    registerMatrixRoute(app, {
      pb,
      logger: noopLogger,
      now: () => NOW,
      loadCells: () => cells,
    });
    const { status, body } = await getMatrix(app);
    expect(status).toBe(200);
    expect(body.error).toBe("matrix_unavailable");
    expect(body.cells).toEqual([]);
  });

  it("fails loud (matrix_unavailable) when the page cap is hit before totalPages (truncation, never partial chips)", async () => {
    // PB keeps reporting more pages (finite `totalPages` far beyond the cap)
    // while returning full pages. The old code only LOGGED at the cap and
    // returned the TRUNCATED rows — the more severe silent truncation. It must
    // THROW like the short-read path so the route degrades to matrix_unavailable
    // rather than serving a badly-truncated matrix as complete.
    const PAGE = 500; // == STATUS_PAGE_SIZE in matrix.ts
    const cells = [integratedCell("acme", "agentic-chat", "wired")];
    const throwMut = (name: string) => () => {
      throw new Error(`read-only route must not call pb.${name}`);
    };
    let calls = 0;
    const pb: PbClient = {
      async list<T>(
        collection: string,
        opts?: ListOpts,
      ): Promise<ListResult<T>> {
        expect(collection).toBe("status");
        calls += 1;
        const page = opts?.page ?? 1;
        const full: StatusRow[] = Array.from({ length: PAGE }, (_, i) =>
          row(keyFor("chat", `p${page}-slug-${i}`), "green"),
        );
        return {
          page,
          perPage: PAGE,
          totalPages: 100_000, // finite but far beyond MAX_STATUS_PAGES
          totalItems: 100_000 * PAGE,
          items: full as unknown as T[],
        };
      },
      getOne: throwMut("getOne") as PbClient["getOne"],
      getFirst: throwMut("getFirst") as PbClient["getFirst"],
      create: throwMut("create") as PbClient["create"],
      update: throwMut("update") as PbClient["update"],
      upsertByField: throwMut("upsertByField") as PbClient["upsertByField"],
      delete: throwMut("delete") as PbClient["delete"],
      deleteByFilter: throwMut("deleteByFilter") as PbClient["deleteByFilter"],
      health: throwMut("health") as PbClient["health"],
      createBackup: throwMut("createBackup") as PbClient["createBackup"],
      downloadBackup: throwMut("downloadBackup") as PbClient["downloadBackup"],
      deleteBackup: throwMut("deleteBackup") as PbClient["deleteBackup"],
    };
    const app = new Hono();
    registerMatrixRoute(app, {
      pb,
      logger: noopLogger,
      now: () => NOW,
      loadCells: () => cells,
    });
    const { status, body } = await getMatrix(app);
    expect(status).toBe(200);
    expect(body.error).toBe("matrix_unavailable");
    expect(body.cells).toEqual([]);
    // Bounded: it stopped at the page cap rather than looping forever.
    expect(calls).toBeLessThanOrEqual(200);
  });

  it("empty first page while authoritative totalItems > 0 → matrix_unavailable (never a silent all-gray 'complete' matrix)", async () => {
    // A transient/inconsistent PB read: page 1 comes back EMPTY while the
    // authoritative `totalItems` (skipTotal:false) still reports rows exist.
    // The `items.length === 0` break must NOT short-circuit the authoritative
    // short-read guard — `reportedTotal` has to be assigned from the page
    // response BEFORE the empty-page break, else the guard never fires and the
    // route serves `cells:[]` as a normal 200 (a silent all-gray matrix that
    // reads as "everything is complete/no-data"). It must fail LOUD.
    const cells = [integratedCell("acme", "agentic-chat", "wired")];
    const pb = pbWithList((async (collection: string) => {
      expect(collection).toBe("status");
      return {
        page: 1,
        perPage: 500,
        totalPages: 1,
        totalItems: 5, // authoritative: rows exist…
        items: [], // …but page 1 came back empty (inconsistent read)
      };
    }) as PbClient["list"]);
    const app = new Hono();
    registerMatrixRoute(app, {
      pb,
      logger: noopLogger,
      now: () => NOW,
      loadCells: () => cells,
    });
    const { status, body } = await getMatrix(app);
    expect(status).toBe(200);
    expect(body.error).toBe("matrix_unavailable");
    expect(body.cells).toEqual([]);
  });

  it("degrades to matrix_unavailable when the catalog enumerator throws (never a 500/crash)", async () => {
    // The real `buildCatalogCells` THROWS (e.g. MissingReferenceIntegrationError
    // on a partial deploy) instead of `process.exit`ing — which is the whole
    // point: a throw is catchable, so a single request can never hard-kill the
    // harness. Prove the route converts that throw into the degraded posture.
    const app = new Hono();
    registerMatrixRoute(app, {
      pb: fakePb([]).pb,
      logger: noopLogger,
      now: () => NOW,
      loadCells: () => {
        throw new MissingReferenceIntegrationError("langgraph-python", [
          "acme",
        ]);
      },
    });
    const { status, body } = await getMatrix(app);
    expect(status).toBe(200);
    expect(body.error).toBe("matrix_unavailable");
    expect(body.cells).toEqual([]);
  });

  // ── MANDATORY red-green: a raw PB-row read (the old "just read /api/runs" /
  //    read the row's `state") MISREPORTS the chip; /api/matrix reports the
  //    TRUE engine-folded chip. Two independent divergence classes. ──────────
  describe("reports the TRUE chip where a raw PB-row read misreports", () => {
    it("infra-error red row: raw state='red' but /api/matrix folds to gray", async () => {
      const cells = [integratedCell("acme", "agentic-chat", "wired")];
      // D3 (e2e) is RED but the failure is INFRA (driver-error) — a broken
      // probe rig, not a product regression. The engine re-maps an
      // infra-only red to NO_DATA → gray. A naive read of the row's `state`
      // (what /api/runs-style consumers see) reports "red".
      const e2eRow = row(keyFor("e2e", "acme", "agentic-chat"), "red", {
        signal: { errorClass: "driver-error" },
      });
      const rows = [e2eRow];
      const { app } = makeApp({ rows, cells });
      const { body } = await getMatrix(app);
      const api = cellOf(body, "acme", "agentic-chat")!;

      const naiveRawChip = e2eRow.state; // "red" — the misreport
      expect(naiveRawChip).toBe("red");
      expect(api.chipColor).toBe("gray"); // TRUE engine-folded chip
      expect(api.chipColor).not.toBe(naiveRawChip);

      // …and the API equals the engine truth, not the raw row.
      const expected = buildCellModel(
        mergeRowsToMap(rows),
        catalogCellToInput(cells[0]!),
        NOW,
      );
      expect(api.chipColor).toBe(expected.chipColor);
    });

    it("stale green ladder: raw state='green' but /api/matrix folds to gray (U8)", async () => {
      const cells = [integratedCell("acme", "agentic-chat", "wired")];
      // A once-green cell whose every contributing row is now past its
      // staleness window → the matrix-stale (U8) fold collapses it to gray
      // ("re-sweep pending"). A naive read of the e2e row still says "green".
      const rows = greenLadder("acme", "agentic-chat", STALE);
      const staleGreenRow = rows[0]!;
      const { app } = makeApp({ rows, cells });
      const { body } = await getMatrix(app);
      const api = cellOf(body, "acme", "agentic-chat")!;

      const naiveRawChip = staleGreenRow.state; // "green" — the misreport
      expect(naiveRawChip).toBe("green");
      expect(api.isStaleCell).toBe(true);
      expect(api.chipColor).toBe("gray"); // TRUE engine-folded chip
      expect(api.chipColor).not.toBe(naiveRawChip);

      const expected = buildCellModel(
        mergeRowsToMap(rows),
        catalogCellToInput(cells[0]!),
        NOW,
      );
      expect(api.chipColor).toBe(expected.chipColor);
    });
  });
});

// The shared flatten is reachable from the LIVE `/api/matrix` handler, so a
// fatal input must signal by THROWING (catchable) — never `process.exit`
// (uncatchable → hard-kills the harness on one request).
describe("generateCatalog — shared-flatten error contract", () => {
  const emptyRegistry: FeatureRegistry = { features: [], categories: [] };

  it("THROWS MissingReferenceIntegrationError (does NOT process.exit) when the reference is absent from a non-empty set", () => {
    expect(() =>
      generateCatalog(emptyRegistry, [{ slug: "acme", name: "Acme" }]),
    ).toThrow(MissingReferenceIntegrationError);
  });

  it("returns an empty catalog cleanly (no throw, no exit) for zero integrations", () => {
    const catalog = generateCatalog(emptyRegistry, []);
    expect(catalog.cells).toEqual([]);
    expect(catalog.metadata.total_cells).toBe(0);
    expect(catalog.metadata.reference).toBe("langgraph-python");
  });
});

// The CLI codegen (`generate-registry.ts`) runs full AJV schema validation and
// `process.exit(1)`s BEFORE `generateCatalog` runs, so `catalog.json` is only
// ever produced from structurally-valid manifests. The harness re-flatten
// (`loadIntegrationManifests`) reads raw manifests directly and USED to apply
// NO validation — a slug-less / malformed manifest flattened into
// `undefined`-keyed garbage cells and could shift parity tiers, diverging from
// the dashboard's validated catalog (breaking the api==render equivalence). The
// loader must apply a structural guard at parity with the codegen so an invalid
// manifest THROWS (→ route catch → matrix_unavailable) rather than emitting
// garbage.
describe("loadIntegrationManifests — structural validation (harness re-flatten parity)", () => {
  function writeManifest(root: string, dir: string, yamlBody: string): void {
    const d = path.join(root, "integrations", dir);
    fs.mkdirSync(d, { recursive: true });
    fs.writeFileSync(path.join(d, "manifest.yaml"), yamlBody, "utf-8");
  }

  const validYaml = [
    "name: Acme",
    "slug: acme",
    "category: popular",
    "language: python",
    "description: An integration",
    "features:",
    "  - agentic-chat",
    "demos:",
    "  - id: agentic-chat",
    "    name: Agentic Chat",
    "    route: /acme/agentic-chat",
    "",
  ].join("\n");

  it("THROWS ManifestValidationError on a slug-less manifest (never emits undefined-keyed cells)", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "matrix-flatten-"));
    try {
      // YAML-valid mapping but schema-invalid: no `slug`. The old loader
      // returned it as-is → generateCatalog produced `undefined/<feature>` cells
      // with `integration: undefined`.
      writeManifest(
        root,
        "badcell",
        ["name: Bad Cell", "features:", "  - agentic-chat", ""].join("\n"),
      );
      expect(() => loadIntegrationManifests(root)).toThrow(
        ManifestValidationError,
      );
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("accepts a structurally-valid manifest", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "matrix-flatten-"));
    try {
      writeManifest(root, "acme", validYaml);
      const manifests = loadIntegrationManifests(root);
      expect(manifests).toHaveLength(1);
      expect(manifests[0]!.slug).toBe("acme");
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});

// §E per-cell fault isolation at the ROUTE level: one malformed featureId must
// degrade to a single gray cell, never take the whole surface to
// matrix_unavailable.
describe("GET /api/matrix — §E per-cell fault isolation", () => {
  it("degrades ONE bad-featureId cell to gray, still renders the rest (never whole-surface matrix_unavailable)", async () => {
    // A featureId containing `/` (or `:`) makes `keyFor` throw inside
    // `buildCellModel`. With NO per-cell guard the throw aborts the whole
    // `cells.map` → the route degrades the ENTIRE surface to matrix_unavailable,
    // defeating the "degrade one cell, never the whole matrix" invariant. With
    // the per-cell catch the bad cell becomes a single gray cell and every other
    // cell still renders.
    const good = integratedCell("acme", "agentic-chat", "wired");
    const bad = integratedCell("acme", "a/b", "wired"); // `/` → keyFor throws
    // A FULL green ladder (incl. the d5/d6 per-cell rows agentic-chat maps to)
    // so the good cell is genuinely GREEN — distinguishable from the degraded
    // BAD cell's gray, proving the good cell is the real computed model and not
    // itself a swallowed error.
    const rows = [
      ...greenLadder("acme", "agentic-chat", FRESH),
      row(keyFor("d5", "acme", "agentic-chat"), "green"),
      row(keyFor("d6", "acme", "agentic-chat"), "green"),
    ];
    const { app } = makeApp({ rows, cells: [bad, good] });
    const { status, body } = await getMatrix(app);
    expect(status).toBe(200);
    expect(body.error).toBeUndefined();
    expect(body.cells).toHaveLength(2);
    const goodCell = cellOf(body, "acme", "agentic-chat")!;
    expect(goodCell.chipColor).toBe("green");
    const badCell = cellOf(body, "acme", "a/b")!;
    expect(badCell.chipColor).toBe("gray");
    expect(badCell.achievedDepth).toBe(0);
  });
});

// §E per-cell fault isolation: the "" featureId normalization in
// `buildCellModel` only neutralizes the empty string — a featureId containing
// `:` or `/` still reaches `keyFor` and THROWS. `computeMatrix` maps
// `computeMatrixCell` over the cell grid, so ONE throwing cell must not abort
// the whole map (which would take the ENTIRE surface to matrix_unavailable). It
// must degrade that ONE cell to a gray/error cell and compute the rest.
describe("computeMatrix — per-cell fault isolation", () => {
  it("a throwing cell (featureId with `/`) degrades to one gray cell; siblings still compute", () => {
    const bad = integratedCell("acme", "a/b", "wired"); // `/` → keyFor throws
    const good = integratedCell("acme", "agentic-chat", "wired");
    const live = mergeRowsToMap([
      ...greenLadder("acme", "agentic-chat", FRESH),
      row(keyFor("d5", "acme", "agentic-chat"), "green"),
      row(keyFor("d6", "acme", "agentic-chat"), "green"),
    ]);
    const out = computeMatrix(live, [bad, good], NOW);
    expect(out).toHaveLength(2);

    const g = out.find((c) => c.featureId === "agentic-chat")!;
    expect(g.chipColor).toBe("green");

    const b = out.find((c) => c.featureId === "a/b")!;
    expect(b.slug).toBe("acme");
    expect(b.chipColor).toBe("gray");
    expect(b.achievedDepth).toBe(0);
  });

  it("invokes the onCellError hook for the throwing cell only", () => {
    const bad = integratedCell("acme", "x:y", "wired"); // `:` → keyFor throws
    const good = integratedCell("acme", "agentic-chat", "wired");
    const live = mergeRowsToMap(greenLadder("acme", "agentic-chat", FRESH));
    const errored: Array<string | null> = [];
    const out = computeMatrix(live, [bad, good], NOW, (cell) => {
      errored.push(cell.feature);
    });
    expect(out).toHaveLength(2);
    expect(errored).toEqual(["x:y"]);
  });
});
