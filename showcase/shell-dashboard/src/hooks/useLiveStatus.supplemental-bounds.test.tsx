/**
 * REAL-SDK regression tests for the BOUNDS and the FAILURE MODE of the
 * SUPPLEMENTAL signal fetch in `useLiveStatus`.
 *
 * Background. The bulk initial fetch projects the heavy `signal` blob away
 * (`STATUS_LIST_FIELDS`), so a supplemental fetch re-reads `signal` for exactly
 * the rows whose verdict depends on it: the comm-error candidate AGGREGATE rows
 * ∪ every row with `state != "green"`. Two properties of that fetch are
 * load-bearing and were previously untested:
 *
 *  1. IT IS BOUNDED. Its pagination loop is a `for(;;)` over a filter whose
 *     selectivity is a function of FLEET HEALTH — nominally ~360 of ~3100 rows
 *     (one page), but during a full-column outage or a bad deploy it trends
 *     toward the whole collection (7 pages, ~1.7 MB measured against
 *     production). An uncapped loop also never terminates against a server that
 *     keeps answering with full pages. So it degrades exactly when the dashboard
 *     matters most, and it is awaited BEFORE any row is returned.
 *
 *  2. ITS FAILURE IS NOT FATAL. It is an ENRICHMENT fetch: its rows only add
 *     `signal` to rows the bulk fetch already delivered. If it rejects, the
 *     right outcome is a dashboard that renders with `signal` unknown — under
 *     the classifier's fail-safe polarity a non-green row with no `signal` is
 *     painted RED, never gray — NOT a blanked dashboard. Propagating the
 *     rejection through `fetchInitial` → `connect()` → the retry chain lands
 *     `rows: []` + `status: "error"`, i.e. a supplemental failure hides the
 *     ENTIRE matrix, which is strictly worse than the half-blind cold load the
 *     fetch was added to fix.
 *
 * These tests drive the REAL hook against the REAL PocketBase SDK over a real
 * socket (the sibling mocked suite cannot observe wire-level pagination or an
 * HTTP-level failure).
 *
 * EVERY fake endpoint below — all three of them, on both their bulk and their
 * supplemental legs — answers through the ONE shared evaluator
 * (`__tests__/pb-query-eval.ts`, whose semantics are verified against a real
 * PocketBase server), so `filter`, `sort`, `fields` and `skipTotal` are all
 * honoured and a response is a function of the query the hook actually sent
 * rather than of fixture layout. Two of them previously ignored `filter`
 * outright while this preamble claimed otherwise, which meant a widened
 * supplemental filter was invisible to the cap tests. The page-cap servers
 * SYNTHESIZE their pages (an unbounded page stream is the point, and no fixture
 * array can hold one), so they pass `alreadyPaged` — the slice is theirs, the
 * filter and projection are still the evaluator's.
 *
 * A query the evaluator cannot model comes back as the real server's own 400
 * carrying the parse message, never as an exception out of the request handler:
 * that throw sends NO response, so the hook hangs and the test dies on a 20 s
 * `waitFor` timeout with the parse message nowhere in sight.
 */
import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  beforeEach,
  afterEach,
  vi,
} from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { createServer } from "node:http";
import type { Server, ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { buildCellModel } from "../lib/cell-model";
import {
  keyFor,
  mergeRowsToMap,
  STATUS_LIST_FIELDS,
  FLEET_COMM_ERROR_SIGNAL_KEY,
} from "../lib/live-status";
import {
  readPbListRequest,
  classifyPbListRequest,
  evaluatePbList,
  PB_PER_PAGE_CLAMP,
} from "./__tests__/pb-query-eval";
import type { PbRow, PbListRequest } from "./__tests__/pb-query-eval";

// PocketBase's server-side `perPage` ceiling, imported rather than restated so
// the fakes and the evaluator that clamps for them cannot drift apart.
const PER_PAGE_CLAMP = PB_PER_PAGE_CLAMP;

/**
 * The supplemental fetch's page cap. MUST match `MAX_INITIAL_FETCH_PAGES` in
 * `useLiveStatus.ts`; pinned as a literal here on purpose, so retuning the
 * constant is a conscious decision that shows up as a failing test rather than
 * a silently widened first-paint budget (same posture as the
 * `STATUS_LIST_FIELDS` drift guard in `live-status.test.ts`).
 */
const EXPECTED_MAX_INITIAL_PAGES = 20;

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify(body));
}

/** Send an already-serialized body (what `evaluatePbList` returns). */
function sendRaw(res: ServerResponse, status: number, body: string): void {
  res.statusCode = status;
  res.setHeader("content-type", "application/json");
  res.end(body);
}

// ---------------------------------------------------------------------------
// A. The supplemental fetch is PAGE-BOUNDED
// ---------------------------------------------------------------------------

// How many FULL pages this server is willing to answer the supplemental query
// with. Chosen at 2x the cap so the test can prove the hook stopped EARLY (it
// must never ask for page 21) rather than merely reaching the end of a fixture.
const RUNAWAY_FULL_PAGES = 40;

// Pages the supplemental fetch actually requested, in issue order.
const runawaySupplementalPages: number[] = [];
// Pages the bulk fetch requested, so the two loops can never be conflated.
const runawayBulkPages: number[] = [];

/**
 * A collection whose NON-GREEN set is larger than the cap — the incident-scale
 * shape (plus headroom for collection growth). The bulk query is answered from
 * a tiny fixture and the supplemental query from a synthesized unbounded page
 * stream; that asymmetry is deliberate and is the point of the test: it
 * isolates the SUPPLEMENTAL loop's bound from the bulk loop's, which cannot be
 * done with one shared fixture (the supplemental result is a subset of the
 * collection, so a fixture big enough to unbound one unbounds both).
 */
const RUNAWAY_BULK_ROWS: PbRow[] = Array.from({ length: 3 }, (_, i) => ({
  id: `b${i}`,
  key: `smoke:runaway/f${i}`,
  dimension: "smoke",
  state: "red",
  signal: { note: "bulk" },
  observed_at: "2026-04-20T00:00:00Z",
  transitioned_at: "2026-04-20T00:00:00Z",
  fail_count: 3,
  first_failure_at: "2026-04-20T00:00:00Z",
}));

function synthNonGreenPage(page: number): PbRow[] {
  if (page > RUNAWAY_FULL_PAGES) return [];
  return Array.from({ length: PER_PAGE_CLAMP }, (_, i) => {
    const n = (page - 1) * PER_PAGE_CLAMP + i;
    return {
      id: `s${String(n).padStart(6, "0")}`,
      key: `d5:runaway/f${n}`,
      dimension: "d5",
      state: "red",
      signal: { note: "supplemental" },
      observed_at: "2026-04-20T00:00:00Z",
      transitioned_at: "2026-04-20T00:00:00Z",
      fail_count: 3,
      first_failure_at: "2026-04-20T00:00:00Z",
    };
  });
}

function startRunawayServer(): Promise<{ server: Server; url: string }> {
  const srv = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    if (!url.pathname.startsWith("/api/collections/status/records")) {
      sendJson(res, 404, { message: "not found" });
      return;
    }
    let listReq: PbListRequest;
    try {
      listReq = readPbListRequest(url);
    } catch (err) {
      // A malformed `page`/`perPage` is the real server's 400, not a silently
      // empty page (which the hook would read as "end of collection").
      sendJson(res, 400, {
        code: 400,
        message: err instanceof Error ? err.message : String(err),
        data: {},
      });
      return;
    }
    const kind = classifyPbListRequest(listReq);
    if (kind === "heartbeat") {
      sendJson(res, 200, { page: 1, perPage: 1, items: [] });
      return;
    }
    if (kind === "supplemental") {
      runawaySupplementalPages.push(listReq.page);
      // `alreadyPaged`: this leg SYNTHESIZES the requested page (the unbounded
      // stream is the point), so the slice is ours — but `filter`, `sort`,
      // `fields` and `skipTotal` are still evaluated, so a supplemental filter
      // that stopped selecting these rows, or widened past them, is visible.
      const out = evaluatePbList(synthNonGreenPage(listReq.page), listReq, {
        alreadyPaged: true,
      });
      sendRaw(res, out.status, out.body);
      return;
    }
    runawayBulkPages.push(listReq.page);
    const out = evaluatePbList(RUNAWAY_BULK_ROWS, listReq);
    sendRaw(res, out.status, out.body);
  });
  return new Promise((resolve) => {
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address() as AddressInfo;
      resolve({ server: srv, url: `http://127.0.0.1:${port}` });
    });
  });
}

// ---------------------------------------------------------------------------
// B / C. Honest small-collection server (filter + fields + sort all evaluated)
// ---------------------------------------------------------------------------

const NOW_ISO = "2026-06-04T12:00:00.000Z";
const NOW_MS = Date.parse(NOW_ISO);
const OBSERVED_ISO = "2026-06-04T11:59:30.000Z";

const RED_SLUG = "acme";
const OVERLAY_SLUG = "beta";
const FEATURE = "beautiful-chat";

/** A genuinely-failing per-cell e2e row — the cold-load red this PR protects. */
const RED_ROW: Record<string, unknown> = {
  id: "red-1",
  key: keyFor("e2e", RED_SLUG, FEATURE),
  dimension: "e2e",
  state: "red",
  signal: { errorClass: "assertion-failed", message: "pill never rendered" },
  observed_at: OBSERVED_ISO,
  transitioned_at: OBSERVED_ISO,
  fail_count: 4,
  first_failure_at: OBSERVED_ISO,
};

/**
 * A GREEN `d6:<slug>` aggregate carrying a mirrored comm error — the clause-1
 * row. Green, so the non-green clause can never reach it; its overlay exists
 * only if the comm-error clause fetched it WITH `signal`.
 */
const OVERLAY_AGGREGATE_ROW: Record<string, unknown> = {
  id: "agg-1",
  key: `d6:${OVERLAY_SLUG}`,
  dimension: "d6",
  state: "green",
  signal: {
    [FLEET_COMM_ERROR_SIGNAL_KEY]: {
      kind: "worker-unreachable",
      message: "worker w-7 stopped answering",
      observedAt: OBSERVED_ISO,
    },
  },
  observed_at: OBSERVED_ISO,
  transitioned_at: OBSERVED_ISO,
  fail_count: 0,
  first_failure_at: null,
};

/** A green PER-CELL row: matches NEITHER supplemental clause. */
const GREEN_FILLER_ROW: Record<string, unknown> = {
  id: "green-1",
  key: keyFor("e2e", "gamma", FEATURE),
  dimension: "e2e",
  state: "green",
  signal: { note: "should never be re-fetched" },
  observed_at: OBSERVED_ISO,
  transitioned_at: OBSERVED_ISO,
  fail_count: 0,
  first_failure_at: null,
};

const HONEST_ROWS = [RED_ROW, OVERLAY_AGGREGATE_ROW, GREEN_FILLER_ROW];

interface HonestServerState {
  /** HTTP status to answer the SUPPLEMENTAL request with (200 = serve normally). */
  supplementalStatus: number;
  /** Query strings of every supplemental request, in issue order. */
  supplementalQueries: URLSearchParams[];
  /** Keys the supplemental responses actually carried (filter fidelity check). */
  supplementalServedKeys: string[];
  /** Query strings of every bulk page request. */
  bulkQueries: URLSearchParams[];
}

const honest: HonestServerState = {
  supplementalStatus: 200,
  supplementalQueries: [],
  supplementalServedKeys: [],
  bulkQueries: [],
};

function startHonestServer(): Promise<{ server: Server; url: string }> {
  const srv = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    if (!url.pathname.startsWith("/api/collections/status/records")) {
      sendJson(res, 404, { message: "not found" });
      return;
    }
    const q = url.searchParams;
    let listReq: PbListRequest;
    try {
      listReq = readPbListRequest(url);
    } catch (err) {
      sendJson(res, 400, {
        code: 400,
        message: err instanceof Error ? err.message : String(err),
        data: {},
      });
      return;
    }
    const kind = classifyPbListRequest(listReq);
    if (kind === "heartbeat") {
      sendJson(res, 200, { page: 1, perPage: 1, items: [] });
      return;
    }
    if (kind === "supplemental") {
      honest.supplementalQueries.push(new URLSearchParams(q));
      if (honest.supplementalStatus !== 200) {
        sendJson(res, honest.supplementalStatus, {
          code: honest.supplementalStatus,
          message: "supplemental fetch is unavailable",
          data: {},
        });
        return;
      }
    } else {
      honest.bulkQueries.push(new URLSearchParams(q));
    }
    const out = evaluatePbList(HONEST_ROWS, listReq);
    if (out.status === 200 && kind === "supplemental") {
      // The keys the filter ACTUALLY selected — the selectivity oracle. Records
      // duplicates too, so a row served twice is visible to a length check.
      honest.supplementalServedKeys.push(
        ...out.items.map((r) => String(r.key)),
      );
    }
    sendRaw(res, out.status, out.body);
  });
  return new Promise((resolve) => {
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address() as AddressInfo;
      resolve({ server: srv, url: `http://127.0.0.1:${port}` });
    });
  });
}

// ---------------------------------------------------------------------------
// Shared jsdom / runtime-config plumbing (mirrors useLiveStatus.autocancel)
// ---------------------------------------------------------------------------

let prevConfig: unknown;
let hadConfig = false;

function installEnv(baseUrl: string): void {
  vi.stubGlobal(
    "EventSource",
    class {
      close(): void {}
      addEventListener(): void {}
      removeEventListener(): void {}
    },
  );
  const store = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => store.set(k, v),
    removeItem: (k: string) => store.delete(k),
    clear: () => store.clear(),
  });
  const win = (globalThis as unknown as { window: Window & typeof globalThis })
    .window as unknown as { __SHOWCASE_CONFIG__?: unknown };
  hadConfig = "__SHOWCASE_CONFIG__" in win;
  prevConfig = win.__SHOWCASE_CONFIG__;
  win.__SHOWCASE_CONFIG__ = {
    pocketbaseUrl: baseUrl,
    shellUrl: baseUrl,
    opsBaseUrl: baseUrl,
  };
  vi.resetModules();
}

function restoreEnv(): void {
  vi.unstubAllGlobals();
  const win = (globalThis as unknown as { window: Window & typeof globalThis })
    .window as unknown as { __SHOWCASE_CONFIG__?: unknown };
  if (hadConfig) {
    win.__SHOWCASE_CONFIG__ = prevConfig;
  } else {
    delete win.__SHOWCASE_CONFIG__;
  }
  vi.resetModules();
}

describe("useLiveStatus supplemental fetch — page bound", () => {
  let server: Server;
  let baseUrl: string;

  beforeAll(async () => {
    const started = await startRunawayServer();
    server = started.server;
    baseUrl = started.url;
  });
  afterAll(() => server.close());

  beforeEach(() => {
    runawaySupplementalPages.length = 0;
    runawayBulkPages.length = 0;
    installEnv(baseUrl);
  });
  afterEach(restoreEnv);

  it("stops after MAX_INITIAL_FETCH_PAGES instead of paginating without bound", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { useLiveStatus } = await import("./useLiveStatus");
    const { result, unmount } = renderHook(() => useLiveStatus());
    try {
      // First paint must still happen. Pre-fix this ALSO happens — after the
      // supplemental loop has walked every page the server will serve (and,
      // against a server that never returns a short page, never at all).
      await waitFor(() => expect(result.current.status).toBe("live"), {
        timeout: 20_000,
      });

      // THE BOUND. Pre-fix the loop reads all RUNAWAY_FULL_PAGES pages, so this
      // fails with `expected 40 to be less than or equal to 20`.
      expect(runawaySupplementalPages.length).toBeLessThanOrEqual(
        EXPECTED_MAX_INITIAL_PAGES,
      );
      expect(Math.max(...runawaySupplementalPages)).toBeLessThanOrEqual(
        EXPECTED_MAX_INITIAL_PAGES,
      );
      // It stopped EARLY, not at the end of what the server would serve: the
      // server had pages 21..40 ready and was never asked for them. This is
      // what makes the assertion above a real cap rather than fixture length.
      expect(runawaySupplementalPages).not.toContain(
        EXPECTED_MAX_INITIAL_PAGES + 1,
      );

      // Truncation is an operational anomaly, not a silent one.
      expect(
        warn.mock.calls.some((call) =>
          String(call[0]).includes("supplemental signal fetch truncated"),
        ),
      ).toBe(true);

      // Degradation shape: the bulk rows are all present and rendering. The
      // rows we declined to enrich simply arrive without `signal`, which the
      // classifier's fail-safe polarity paints RED (never gray).
      expect(result.current.error).toBeNull();
      for (const row of RUNAWAY_BULK_ROWS) {
        expect(result.current.rows.some((r) => r.key === String(row.key))).toBe(
          true,
        );
      }
    } finally {
      unmount();
      warn.mockRestore();
    }
  }, 30_000);

  it("leaves the bulk loop's own short-page termination alone", async () => {
    // The shared pagination helper must not change bulk behavior for a normal
    // collection: page 1 is short here, so there is no fan-out and no second
    // page — the cap is inert on the happy path.
    const { useLiveStatus } = await import("./useLiveStatus");
    const { result, unmount } = renderHook(() => useLiveStatus());
    try {
      await waitFor(() => expect(result.current.status).toBe("live"), {
        timeout: 20_000,
      });
      expect(runawayBulkPages).toEqual([1]);
    } finally {
      unmount();
    }
  }, 30_000);
});

// ---------------------------------------------------------------------------
// A2. The BULK loop is capped too — and truncation there FAILS LOUD
// ---------------------------------------------------------------------------

/** Pages the bulk loop requested against the runaway-BULK server. */
const runawayBulkOnlyPages: number[] = [];

/**
 * Mirror image of the runaway server: the BULK query never returns a short page
 * (so its loop is what runs away), while the supplemental query terminates
 * immediately. Isolates the bulk loop's bound and its DIFFERENT on-cap
 * behavior — a truncated bulk snapshot silently drops whole cells to no-data
 * gray, so it must surface as an error rather than a partial matrix.
 */
function startRunawayBulkServer(): Promise<{ server: Server; url: string }> {
  const srv = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    if (!url.pathname.startsWith("/api/collections/status/records")) {
      sendJson(res, 404, { message: "not found" });
      return;
    }
    let listReq: PbListRequest;
    try {
      listReq = readPbListRequest(url);
    } catch (err) {
      sendJson(res, 400, {
        code: 400,
        message: err instanceof Error ? err.message : String(err),
        data: {},
      });
      return;
    }
    const kind = classifyPbListRequest(listReq);
    if (kind === "heartbeat") {
      sendJson(res, 200, { page: 1, perPage: 1, items: [] });
      return;
    }
    if (kind === "supplemental") {
      // Terminates immediately: this server isolates the BULK loop's bound.
      // Still routed through the evaluator so the empty page carries the
      // `skipTotal` envelope shape the hook actually receives.
      const out = evaluatePbList([], listReq, { alreadyPaged: true });
      sendRaw(res, out.status, out.body);
      return;
    }
    runawayBulkOnlyPages.push(listReq.page);
    // `alreadyPaged` for the same reason as the runaway supplemental leg.
    const out = evaluatePbList(synthNonGreenPage(listReq.page), listReq, {
      alreadyPaged: true,
    });
    sendRaw(res, out.status, out.body);
  });
  return new Promise((resolve) => {
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address() as AddressInfo;
      resolve({ server: srv, url: `http://127.0.0.1:${port}` });
    });
  });
}

describe("useLiveStatus bulk fetch — page bound fails loud", () => {
  let server: Server;
  let baseUrl: string;

  beforeAll(async () => {
    const started = await startRunawayBulkServer();
    server = started.server;
    baseUrl = started.url;
  });
  afterAll(() => server.close());

  beforeEach(() => {
    runawayBulkOnlyPages.length = 0;
    installEnv(baseUrl);
  });
  afterEach(restoreEnv);

  it("never requests past the cap, and surfaces an error instead of a partial matrix", async () => {
    const { useLiveStatus } = await import("./useLiveStatus");
    const { result, unmount } = renderHook(() => useLiveStatus());
    try {
      // Pre-fix the loop walks all 40 pages the server will serve and then
      // reports a "complete" 20,000-row snapshot as live.
      await waitFor(() => expect(result.current.status).toBe("error"), {
        timeout: 25_000,
      });
      expect(Math.max(...runawayBulkOnlyPages)).toBeLessThanOrEqual(
        EXPECTED_MAX_INITIAL_PAGES,
      );
      expect(runawayBulkOnlyPages).not.toContain(
        EXPECTED_MAX_INITIAL_PAGES + 1,
      );
      // No stale-green lie behind the banner.
      expect(result.current.rows).toEqual([]);
      expect(result.current.error).toContain("exceeded");
    } finally {
      unmount();
    }
  }, 40_000);
});

describe("useLiveStatus supplemental fetch — failure degrades, never blanks", () => {
  let server: Server;
  let baseUrl: string;

  beforeAll(async () => {
    const started = await startHonestServer();
    server = started.server;
    baseUrl = started.url;
  });
  afterAll(() => server.close());

  beforeEach(() => {
    honest.supplementalStatus = 200;
    honest.supplementalQueries.length = 0;
    honest.supplementalServedKeys.length = 0;
    honest.bulkQueries.length = 0;
    installEnv(baseUrl);
  });
  afterEach(restoreEnv);

  it("renders the matrix — with reds still RED — when the supplemental fetch 500s", async () => {
    honest.supplementalStatus = 500;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { useLiveStatus } = await import("./useLiveStatus");
    const { result, unmount } = renderHook(() => useLiveStatus());
    try {
      // Settle: either the dashboard came up, or the retry chain gave up.
      await waitFor(
        () => expect(result.current.status).not.toBe("connecting"),
        { timeout: 20_000 },
      );

      // Pre-fix this is `"error"`: the supplemental rejection propagates through
      // fetchInitial → connect() → MAX_RECONNECT_ATTEMPTS → setRows([]) +
      // status "error". An ENRICHMENT failure must not blank the matrix.
      expect(result.current.status).toBe("live");
      expect(result.current.rows).toHaveLength(HONEST_ROWS.length);

      // The rows we could not enrich carry NO `signal`...
      const red = result.current.rows.find(
        (r) => r.key === keyFor("e2e", RED_SLUG, FEATURE),
      );
      expect(red).toBeDefined();
      expect(red?.signal).toBeUndefined();

      // ...and the fail-safe polarity means the cell still renders RED, which is
      // the entire point of the PR this fetch belongs to. A signal-less red must
      // never fall back to gray.
      const model = buildCellModel(
        mergeRowsToMap([...result.current.rows]),
        {
          slug: RED_SLUG,
          featureId: FEATURE,
          isSupported: true,
          isWired: true,
        },
        NOW_MS,
      );
      expect(model.chipColor).toBe("red");

      // The failure is reported, not swallowed.
      expect(
        warn.mock.calls.some((call) =>
          String(call[0]).includes("supplemental signal fetch failed"),
        ),
      ).toBe(true);
    } finally {
      unmount();
      warn.mockRestore();
    }
  }, 30_000);
});

describe("useLiveStatus supplemental fetch — cold-load correctness + projection", () => {
  let server: Server;
  let baseUrl: string;

  beforeAll(async () => {
    const started = await startHonestServer();
    server = started.server;
    baseUrl = started.url;
  });
  afterAll(() => server.close());

  beforeEach(() => {
    honest.supplementalStatus = 200;
    honest.supplementalQueries.length = 0;
    honest.supplementalServedKeys.length = 0;
    honest.bulkQueries.length = 0;
    installEnv(baseUrl);
  });
  afterEach(restoreEnv);

  it("projects to exactly the declared StatusRow shape (signal included) and selects only the rows that need it", async () => {
    const { useLiveStatus } = await import("./useLiveStatus");
    const { result, unmount } = renderHook(() => useLiveStatus());
    try {
      await waitFor(() => expect(result.current.status).toBe("live"), {
        timeout: 20_000,
      });

      expect(honest.supplementalQueries).toHaveLength(1);
      const q = honest.supplementalQueries[0]!;

      // PROJECTION. The supplemental fetch asks for `signal` PLUS every other
      // declared StatusRow field and nothing else. Both halves are load-bearing:
      //   - `signal` is the whole reason the request exists;
      //   - the rest keep the response a COMPLETE StatusRow, which is what lets
      //     the merge replace its bulk twin wholesale (and append a row the bulk
      //     snapshot missed) instead of grafting a field onto a row of a
      //     different vintage;
      //   - and naming them explicitly drops PocketBase's undeclared columns
      //     (collectionId/collectionName/created/updated/…), measured at 15% of
      //     this response against production.
      const fields = (q.get("fields") ?? "").split(",").filter(Boolean);
      expect(new Set(fields)).toEqual(
        new Set([...STATUS_LIST_FIELDS.split(","), "signal"]),
      );

      // SELECTIVITY. The server evaluated the filter for real, so this is the
      // set of rows the hook's filter actually selected: the red per-cell row
      // (non-green clause) and the green d6 aggregate (comm-error clause). The
      // green PER-CELL row matches neither and must not be re-fetched.
      expect(new Set(honest.supplementalServedKeys)).toEqual(
        new Set([keyFor("e2e", RED_SLUG, FEATURE), `d6:${OVERLAY_SLUG}`]),
      );

      // The bulk pages still project `signal` away.
      expect(honest.bulkQueries.length).toBeGreaterThan(0);
      for (const bq of honest.bulkQueries) {
        expect((bq.get("fields") ?? "").split(",")).not.toContain("signal");
      }
    } finally {
      unmount();
    }
  }, 30_000);

  it("a red cell renders RED and a comm-error overlay renders, both from a COLD load", async () => {
    const { useLiveStatus } = await import("./useLiveStatus");
    const { result, unmount } = renderHook(() => useLiveStatus());
    try {
      await waitFor(() => expect(result.current.status).toBe("live"), {
        timeout: 20_000,
      });
      const live = mergeRowsToMap([...result.current.rows]);

      // Clause 2: the red row came back WITH its signal, and the cell is RED.
      const red = live.get(keyFor("e2e", RED_SLUG, FEATURE));
      expect(red?.signal).toEqual(RED_ROW.signal);
      const redModel = buildCellModel(
        live,
        {
          slug: RED_SLUG,
          featureId: FEATURE,
          isSupported: true,
          isWired: true,
        },
        NOW_MS,
      );
      expect(redModel.chipColor).toBe("red");

      // Clause 1: the GREEN aggregate's mirrored comm error is visible on the
      // very first paint — no SSE delta needed (CF7-F3 #1).
      const overlayModel = buildCellModel(
        live,
        {
          slug: OVERLAY_SLUG,
          featureId: FEATURE,
          isSupported: true,
          isWired: true,
        },
        NOW_MS,
      );
      expect(overlayModel.commError?.kind).toBe("worker-unreachable");
      expect(overlayModel.surfaceState).toBe("unreachable");

      // And the green per-cell row is still signal-less (bulk projection intact).
      expect(live.get(keyFor("e2e", "gamma", FEATURE))?.signal).toBeUndefined();
    } finally {
      unmount();
    }
  }, 30_000);
});
