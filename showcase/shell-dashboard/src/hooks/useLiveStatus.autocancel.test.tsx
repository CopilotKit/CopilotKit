/**
 * REAL-SDK regression test for the PocketBase auto-cancellation bug.
 *
 * The sibling `useLiveStatus.test.tsx` mocks `../lib/pb`, so it never
 * exercises the real PocketBase JS SDK and therefore MISSED this bug: the
 * SDK derives a request key from `method + path` and AUTO-CANCELS any
 * in-flight request that shares it. `fetchInitial` fans pages 2..N out
 * CONCURRENTLY at the SAME path (`/api/collections/status/records`), so
 * every page after the first would cancel its predecessor — the cancelled
 * promises reject, `Promise.all` rejects, and the hook drops to OFFLINE.
 *
 * This test stands up a real in-process Node http server that serves the
 * status records endpoint paged with a per-page delay (so multiple fan-out
 * pages are genuinely in flight at once), points the PRODUCTION `getPb()`
 * client at it, drives the REAL hook, and asserts it reaches "live" with
 * ALL pages' rows. It is RED if `requestKey: null` is removed from the list
 * options and GREEN with it.
 *
 * NOTE: this file deliberately does NOT mock `../lib/pb` — it uses the real
 * SDK against a real socket. EventSource + localStorage are stubbed because
 * jsdom lacks the realtime/SSE plumbing the subscribe() path needs; we only
 * assert the initial paged fetch here (the bug lives in fetchInitial, not in
 * the SSE subscribe path).
 *
 * The fake servers answer a list request the way REAL PocketBase does — they
 * honour `filter`, `fields`, `sort` and `skipTotal`, via the ONE shared
 * evaluator in `__tests__/pb-query-eval.ts` (whose semantics are verified
 * against a real PocketBase server). That is load-bearing, not cosmetic: see
 * that module's WHY THIS EXISTS block for the dropped-tail regression a
 * filter-IGNORING fake server silently caused.
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
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";

// ---------------------------------------------------------------------------
// PocketBase list-endpoint FIDELITY, shared by every fake server below.
//
// Real PocketBase applies `filter`, then `sort`, then the page slice, then the
// `fields` projection, and omits the COUNT(*) envelope when `skipTotal` is set.
// `evaluatePbList` does exactly that, and answers a query it cannot model with
// the same 400 the real server sends rather than throwing (a throw inside a
// `createServer` handler sends no response at all, so the hook hangs and the
// test dies on a 20 s `waitFor` timeout instead of reporting the parse
// message).
//
// This file used to carry its OWN ~300-line copy of that evaluator, which
// disagreed with the shared module on quoting, LIKE semantics, numeric ordering
// and sort direction. There is now exactly one, verified against a real
// PocketBase server — see `__tests__/pb-query-eval.ts`. Honouring the query is
// load-bearing, not cosmetic: see the WHY THIS EXISTS block there for the
// dropped-tail guard a filter-IGNORING fake silently disarmed.
// ---------------------------------------------------------------------------
import {
  readPbListRequest,
  classifyPbListRequest,
  evaluatePbList,
} from "./__tests__/pb-query-eval";

// Total rows the fake server serves, spread across PB's 500-row page clamp.
// 1300 rows → 3 pages (500 + 500 + 300). The server honours `skipTotal` (it
// returns NO totalItems / totalPages), so the hook can no longer learn the
// page count up front — it paginates by length (keep fetching until a page
// returns fewer than perPage items). Page 1 (full 500) tells the hook to fan
// out the next concurrent wave; pages 2 & 3 land in flight together — exactly
// the scenario the SDK's same-path auto-cancellation breaks.
const TOTAL_ROWS = 1300;
// Per-page artificial latency. Long enough that pages 2 & 3 are GENUINELY
// in flight simultaneously, so the SDK's same-path auto-cancel actually
// fires (a zero-delay server might resolve page 2 before page 3 is even
// dispatched, masking the bug).
const PAGE_DELAY_MS = 40;

function makeRow(i: number): Record<string, unknown> {
  const id = `r${String(i).padStart(4, "0")}`;
  return {
    id,
    key: `smoke:int/f${id}`,
    dimension: "smoke",
    state: "green",
    signal: {},
    observed_at: "2026-04-20T00:00:00Z",
    transitioned_at: "2026-04-20T00:00:00Z",
    fail_count: 0,
    first_failure_at: null,
  };
}

const ALL_ROWS = Array.from({ length: TOTAL_ROWS }, (_, i) => makeRow(i));

// Captures the query string of every BULK initial-fetch list request the hook
// issues, so the test can assert the lightweight projection (`fields=`) and
// `skipTotal` are actually sent on the wire. Reset per test.
const initialFetchQueries: URLSearchParams[] = [];
/**
 * The supplemental signal fetch's queries — projected, but WITH `signal`, which
 * is what separates them from the bulk pages (see the split below).
 */
const supplementalQueries: URLSearchParams[] = [];

/**
 * Minimal but FAITHFUL PocketBase list endpoint: honours `?page=`/`?perPage=`
 * (clamped to 500, like real PB), `?filter=`, `?fields=`, `?sort=` and
 * `?skipTotal=` (all via the shared `evaluatePbList`), and delays each response
 * by PAGE_DELAY_MS so concurrent fan-out pages overlap on the wire.
 */
function startPbServer(): Promise<{ server: Server; url: string }> {
  const server = createServer((rawReq, res) => {
    const url = new URL(rawReq.url ?? "/", "http://127.0.0.1");
    if (!url.pathname.startsWith("/api/collections/status/records")) {
      res.statusCode = 404;
      res.end(JSON.stringify({ message: "not found" }));
      return;
    }
    const req = readPbListRequest(url);
    // Split the wire instrumentation three ways. The perPage=1 heartbeat ping
    // is ignored, and the SUPPLEMENTAL signal fetch is recorded SEPARATELY from
    // the bulk pages (it deliberately asks for `signal` in its projection, so
    // folding it in would fail the "every bulk page projects `signal` away"
    // assertion).
    if (req.perPage > 1) {
      const q = new URLSearchParams(url.searchParams);
      if (classifyPbListRequest(req) === "supplemental") {
        supplementalQueries.push(q);
      } else {
        initialFetchQueries.push(q);
      }
    }
    // A filter clause the evaluator cannot model is a HARD failure, never a
    // silent match-everything: `evaluatePbList` returns the real server's own
    // 400 carrying the parse message, so the SDK rejects and the hook lands in
    // "error" instead of the test passing on a fake's blind spot.
    const out = evaluatePbList(ALL_ROWS, req);
    if (out.status !== 200) {
      res.statusCode = out.status;
      res.setHeader("content-type", "application/json");
      res.end(out.body);
      return;
    }
    // Delay so concurrent fan-out pages are genuinely in flight together.
    setTimeout(() => {
      res.setHeader("content-type", "application/json");
      res.end(out.body);
    }, PAGE_DELAY_MS);
  });
  return new Promise((resolve) => {
    // Bind to 127.0.0.1 (not localhost) — the PB SDK warns localhost can
    // mis-resolve to ::1 and refuse the connection in Node.
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as AddressInfo;
      resolve({ server, url: `http://127.0.0.1:${port}` });
    });
  });
}

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  const started = await startPbServer();
  server = started.server;
  baseUrl = started.url;
});

afterAll(() => {
  server.close();
});

// Snapshot of `window.__SHOWCASE_CONFIG__` so beforeEach's injection is
// reverted in afterEach — otherwise the fake-server URL leaks into any later
// test in the same worker that reads runtime config.
let prevShowcaseConfig: unknown;
let hadShowcaseConfig = false;

beforeEach(() => {
  // jsdom has neither EventSource (PB realtime/SSE) nor a usable localStorage
  // for the SDK's auth store. Stub both so constructing/driving the real
  // PocketBase client doesn't blow up — we never exercise the SSE subscribe
  // path here (the bug under test is in the initial paged fetch).
  //
  // Use vi.stubGlobal so vi.unstubAllGlobals() in afterEach fully restores the
  // originals: the previous Object.defineProperty / raw-assignment approach
  // overwrote globalThis.EventSource and globalThis.localStorage and never put
  // them back, contaminating any sibling test that touched those globals.
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
  // Point the production runtime-config reader at our fake server, then reset
  // the pb module so getPb() rebuilds its singleton against this URL. Snapshot
  // the prior value so afterEach can restore it (window is shared jsdom state,
  // not a global vi.stubGlobal can track).
  const win = (globalThis as unknown as { window: Window & typeof globalThis })
    .window as unknown as { __SHOWCASE_CONFIG__?: unknown };
  hadShowcaseConfig = "__SHOWCASE_CONFIG__" in win;
  prevShowcaseConfig = win.__SHOWCASE_CONFIG__;
  win.__SHOWCASE_CONFIG__ = {
    pocketbaseUrl: baseUrl,
    shellUrl: baseUrl,
    opsBaseUrl: baseUrl,
  };
  // Clear captured initial-fetch query strings so each test sees only its own
  // requests.
  initialFetchQueries.length = 0;
  supplementalQueries.length = 0;
  vi.resetModules();
});

afterEach(() => {
  // Restore every global we stubbed (EventSource, localStorage) and the
  // window config we injected, so nothing leaks into sibling tests.
  vi.unstubAllGlobals();
  const win = (globalThis as unknown as { window: Window & typeof globalThis })
    .window as unknown as { __SHOWCASE_CONFIG__?: unknown };
  if (hadShowcaseConfig) {
    win.__SHOWCASE_CONFIG__ = prevShowcaseConfig;
  } else {
    delete win.__SHOWCASE_CONFIG__;
  }
  vi.resetModules();
});

describe("useLiveStatus (real PocketBase SDK — auto-cancellation regression)", () => {
  it("reaches live with ALL pages despite concurrent same-path fan-out", async () => {
    // Import AFTER resetModules + config injection so the hook closes over a
    // freshly-constructed pb singleton pointed at our fake server.
    const { useLiveStatus } = await import("./useLiveStatus");
    const { result, unmount } = renderHook(() => useLiveStatus("smoke"));

    try {
      // Without `requestKey: null`, pages 2 & 3 share the page-1 auto request
      // key, get auto-cancelled, Promise.all rejects, and the hook lands in
      // "error" (or never reaches "live") instead. The fix lets every page
      // complete → all 1300 rows → "live".
      await waitFor(() => expect(result.current.status).toBe("live"), {
        timeout: 5000,
      });
      expect(result.current.rows).toHaveLength(TOTAL_ROWS);
      expect(result.current.error).toBeNull();

      // B.1 wire contract: the bulk initial fetch must trim the heavy `signal`
      // field (lightweight `fields=` projection) and skip the COUNT(*) query
      // (`skipTotal`). With skipTotal the server returns no totalPages, so the
      // hook can only have collected all 1300 rows by paginating on
      // items.length — proving the length-based switch landed. We assert the
      // wire flags on EVERY initial-fetch page so a regression on any page is
      // caught.
      expect(initialFetchQueries.length).toBeGreaterThan(0);
      for (const q of initialFetchQueries) {
        const skipTotal = q.get("skipTotal");
        expect(skipTotal === "1" || skipTotal === "true").toBe(true);
        const fields = q.get("fields");
        expect(fields).toBeTruthy();
        // The projection must exclude the heavy `signal` blob but keep `key`.
        expect(fields).not.toContain("signal");
        expect(fields).toContain("key");
      }

      // The SUPPLEMENTAL signal fetch is the other half of that contract, and
      // it must reach the wire even for a dimension scope OUTSIDE the comm-error
      // aggregate set (this hook is scoped to "smoke"). Asserted here on the
      // REAL SDK against a real socket, because the sibling mocked suite cannot
      // see the actual query string. Asking for `signal` is load-bearing: without
      // it in the projection PocketBase omits the blob and the classifier is back
      // to guessing why a rung failed.
      expect(supplementalQueries.length).toBeGreaterThan(0);
      for (const q of supplementalQueries) {
        expect((q.get("fields") ?? "").split(",")).toContain("signal");
        expect(q.get("filter")).toContain('state != "green"');
        // Real-SDK quoting: `pb.filter()` wraps a string param in SINGLE
        // quotes. Asserted on the wire because the sibling mocked suite's
        // `pb.filter` stub JSON-stringifies (double-quotes) the param, so only
        // this suite can catch a filter built for the wrong quoting convention.
        expect(q.get("filter")).toContain("dimension = 'smoke'");
      }
      // The server honours `filter` like real PB, and every fixture row is
      // green, so the supplemental fetch matches NOTHING and its serial walk
      // ends after one empty page. That is what keeps it from masking a bulk
      // pagination bug: `fetchInitial` appends supplemental rows the bulk pages
      // missed, so a filter-ignoring fake would silently repair a dropped tail
      // (see `__tests__/pb-query-eval.ts`). ALL 1300 rows above therefore came
      // from the bulk fan-out alone.
      expect(supplementalQueries).toHaveLength(1);
      expect(supplementalQueries[0]!.get("page")).toBe("1");
    } finally {
      // Reaching "live" starts a 30s setInterval heartbeat that pings the
      // about-to-close in-process server via the pb singleton. Without an
      // explicit unmount the effect cleanup never runs, so the interval (and
      // its pb client) leak past the test and a post-teardown tick fires
      // against a dead socket. Unmounting runs the effect's cleanup
      // (clearHeartbeat + teardownSubscription) before afterAll closes the
      // server.
      unmount();
    }
  }, 10000);
});

// B4: pagination correctness when the SHORT page lands MID-WAVE (as the LAST
// element of a fan-out wave), the exact scenario the #4504 dropped-tail bug
// regressed. With INITIAL_FANOUT_BATCH === 2 the first wave is pages [2,3];
// sizing the fixture so page 2 is FULL (500) and page 3 is SHORT (250) puts the
// short page at the wave's SECOND (final) element. The merge must carry the
// short page's rows and never drop the tail — so the hook must end up with
// EXACTLY 1250 rows, deduplicated, in page order, ending on page 3's last row.
//
// SCOPE OF THIS TEST — no "stops at the first short page" claim. Because the
// short page is the LAST element of its wave, there IS no same-wave page after
// it, so this fixture cannot distinguish "append up to AND INCLUDING the short
// page" from "append the whole wave": both merge pages 2 and 3. (Mutation-proven
// — deleting the merge's short-page boundary logic leaves this test green.) The
// boundary claim is carried by the FIRST-wave-element suite below, which serves
// POISON rows on the page after the short one so a merge that runs past the
// boundary is observable. What this test DOES measure: the short page's tail
// survives, nothing duplicates, and no SECOND wave is armed.
const MIDWAVE_TOTAL_ROWS = 1250; // 500 + 500 + 250: short page is wave elem #2.

function makeMidwaveRow(i: number): Record<string, unknown> {
  const id = `m${String(i).padStart(4, "0")}`;
  return {
    id,
    key: `smoke:mid/f${id}`,
    dimension: "smoke",
    state: "green",
    signal: {},
    observed_at: "2026-04-20T00:00:00Z",
    transitioned_at: "2026-04-20T00:00:00Z",
    fail_count: 0,
    first_failure_at: null,
  };
}

const MIDWAVE_ROWS = Array.from({ length: MIDWAVE_TOTAL_ROWS }, (_, i) =>
  makeMidwaveRow(i),
);

// Page indices the BULK fan-out requested, so the test can assert NO page past
// the short one (page 4+) is ever fetched. The SUPPLEMENTAL fetch's own serial
// walk is recorded separately below: it hits the SAME path with perPage=500, so
// folding the two together made the over-fetch bound unmeasurable — a bulk
// fan-out that skipped a page still "contained" it via the supplemental walk.
const midwaveRequestedPages: number[] = [];
/** Page indices the supplemental serial walk requested (kept out of the above). */
const midwaveSupplementalPages: number[] = [];

function startMidwaveServer(): Promise<{ server: Server; url: string }> {
  const srv = createServer((rawReq, res) => {
    const url = new URL(rawReq.url ?? "/", "http://127.0.0.1");
    if (!url.pathname.startsWith("/api/collections/status/records")) {
      res.statusCode = 404;
      res.end(JSON.stringify({ message: "not found" }));
      return;
    }
    const req = readPbListRequest(url);
    if (req.perPage > 1) {
      if (classifyPbListRequest(req) === "supplemental") {
        midwaveSupplementalPages.push(req.page);
      } else {
        midwaveRequestedPages.push(req.page);
      }
    }
    const out = evaluatePbList(MIDWAVE_ROWS, req);
    if (out.status !== 200) {
      res.statusCode = out.status;
      res.setHeader("content-type", "application/json");
      res.end(out.body);
      return;
    }
    setTimeout(() => {
      res.setHeader("content-type", "application/json");
      res.end(out.body);
    }, PAGE_DELAY_MS);
  });
  return new Promise((resolve) => {
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address() as AddressInfo;
      resolve({ server: srv, url: `http://127.0.0.1:${port}` });
    });
  });
}

let midwaveServer: Server;
let midwaveBaseUrl: string;

describe("useLiveStatus (real PocketBase SDK — mid-wave short-page pagination)", () => {
  beforeAll(async () => {
    const started = await startMidwaveServer();
    midwaveServer = started.server;
    midwaveBaseUrl = started.url;
  });

  afterAll(() => {
    midwaveServer.close();
  });

  let prevConfig: unknown;
  let hadConfig = false;

  beforeEach(() => {
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
    const win = (
      globalThis as unknown as { window: Window & typeof globalThis }
    ).window as unknown as { __SHOWCASE_CONFIG__?: unknown };
    hadConfig = "__SHOWCASE_CONFIG__" in win;
    prevConfig = win.__SHOWCASE_CONFIG__;
    win.__SHOWCASE_CONFIG__ = {
      pocketbaseUrl: midwaveBaseUrl,
      shellUrl: midwaveBaseUrl,
      opsBaseUrl: midwaveBaseUrl,
    };
    midwaveRequestedPages.length = 0;
    midwaveSupplementalPages.length = 0;
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    const win = (
      globalThis as unknown as { window: Window & typeof globalThis }
    ).window as unknown as { __SHOWCASE_CONFIG__?: unknown };
    if (hadConfig) {
      win.__SHOWCASE_CONFIG__ = prevConfig;
    } else {
      delete win.__SHOWCASE_CONFIG__;
    }
    vi.resetModules();
  });

  it("keeps the whole tail when the short page is the last wave element, with no second wave and no duplicates", async () => {
    const { useLiveStatus } = await import("./useLiveStatus");
    const { result, unmount } = renderHook(() => useLiveStatus("smoke"));

    try {
      await waitFor(() => expect(result.current.status).toBe("live"), {
        timeout: 5000,
      });
      // Exact total — no dropped tail (page 3's 250 rows present), no
      // duplicates (each id appears once).
      expect(result.current.rows).toHaveLength(MIDWAVE_TOTAL_ROWS);
      const ids = result.current.rows.map((r) => r.id);
      expect(new Set(ids).size).toBe(MIDWAVE_TOTAL_ROWS);
      expect(result.current.error).toBeNull();
      // The tail is present AND last: page 3's final row terminates the merge,
      // in page order. `.at(-1)` (not a `.some()` membership probe) is what
      // makes this a boundary assertion — a merge that reordered or truncated
      // the tail while keeping the row set would slip past a membership check.
      const lastMidwaveId = MIDWAVE_ROWS[MIDWAVE_TOTAL_ROWS - 1]!.id;
      expect(result.current.rows.at(-1)?.id).toBe(lastMidwaveId);

      // No SECOND wave: the hook must have stopped after the wave containing
      // the short page 3 and NEVER requested page 4 or beyond. (Page 1 alone,
      // then wave [2,3].) These are BULK fan-out pages only — the supplemental
      // fetch's own serial walk is tracked separately, so this genuinely
      // measures the fan-out rather than the union of both request streams.
      expect(midwaveRequestedPages).toContain(1);
      expect(midwaveRequestedPages).toContain(2);
      expect(midwaveRequestedPages).toContain(3);
      expect(Math.max(...midwaveRequestedPages)).toBe(3);
      // And the supplemental walk really is a separate, bounded request stream:
      // every fixture row is green, so its `state != "green"` filter matches
      // nothing and one empty page ends the walk. This is the assertion that
      // proves the instrumentation above is not silently counting supplemental
      // pages as fan-out pages.
      expect(midwaveSupplementalPages).toEqual([1]);
    } finally {
      unmount();
    }
  }, 10000);
});

// B5: pagination correctness when the short page is the FIRST (non-last)
// element of a fan-out wave — the strict generalization of the #4504 locus the
// mid-wave test above only partially exercised. With INITIAL_FANOUT_BATCH === 2
// the first wave is pages [2,3]. The mid-wave test put the short page at wave
// element #2 (page 3, the LAST element). Here we put it at wave element #1
// (page 2 SHORT), so a page issued AFTER the short page WITHIN THE SAME WAVE
// (page 3) is concurrently in flight but its rows must be DROPPED by the merge.
// Sizing: page 1 FULL (500) triggers the fan-out; page 2 SHORT (200) ends the
// collection; page 3 is past-the-end (empty) but was already dispatched in the
// wave. Correct behavior: exactly 700 rows (500 + 200), no duplicates, page 2's
// rows present, NONE of page 3 merged, and NO page 4+ ever requested (the merge
// stops at the first short page and the loop does not arm another wave).
//
// INITIAL_FANOUT_BATCH is a const(2) we do not change. With batch 2, page 3 is
// part of wave 1, so it IS fetched concurrently — that single over-fetch is the
// documented, bounded batch-2 tradeoff (a wave over-fetches past the first short
// page by at most one request). The properties we assert are therefore: the
// merge stops at the short page (page 3's rows never appear) AND no SECOND wave
// is ever armed (no page 4+ requested).
//
// ADVERSARIAL FIXTURE — page 3 serves POISON rows, deliberately breaking real
// PocketBase's monotonic pagination. That is the only way this test can have
// teeth. Real PB returns an EMPTY page 3 here, and an empty page appends
// nothing, so a faithful fixture makes "the merge stops at the first short page"
// VACUOUS: deleting the merge's short-page boundary logic entirely leaves the
// test green (mutation-proven). By answering the page AFTER the short page with
// rows that must NEVER be merged, a merge that runs past the boundary becomes
// directly observable — the poison rows land in `rows`, blowing the exact-total
// and last-row assertions. The poison is served ONLY to bulk (`fields`-
// projected) requests, so the supplemental fetch still sees a faithful server.
const FIRSTELEM_TOTAL_ROWS = 700; // 500 (page 1, full) + 200 (page 2, short).
// Page index from which the server starts lying: 3 is the page the fan-out
// issues alongside the SHORT page 2 in the same wave.
const FIRSTELEM_POISON_FROM_PAGE = 3;
const FIRSTELEM_POISON_ROW_COUNT = 300;

function makeFirstElemRow(i: number): Record<string, unknown> {
  const id = `f${String(i).padStart(4, "0")}`;
  return {
    id,
    key: `smoke:fe/f${id}`,
    dimension: "smoke",
    state: "green",
    signal: {},
    observed_at: "2026-04-20T00:00:00Z",
    transitioned_at: "2026-04-20T00:00:00Z",
    fail_count: 0,
    first_failure_at: null,
  };
}

const FIRSTELEM_ROWS = Array.from({ length: FIRSTELEM_TOTAL_ROWS }, (_, i) =>
  makeFirstElemRow(i),
);

/**
 * Rows the server hands back for the page AFTER the short page. They are NOT
 * part of the collection — if any of them reaches `result.current.rows`, the
 * merge ran past the short-page boundary. Their ids sort AFTER every real row
 * so a naive append also lands them at the tail, tripping the last-row check.
 */
const FIRSTELEM_POISON_ROWS = Array.from(
  { length: FIRSTELEM_POISON_ROW_COUNT },
  (_, i) => {
    const id = `zpoison${String(i).padStart(4, "0")}`;
    return {
      id,
      key: `smoke:fe/poison-${id}`,
      dimension: "smoke",
      state: "green",
      signal: {},
      observed_at: "2026-04-20T00:00:00Z",
      transitioned_at: "2026-04-20T00:00:00Z",
      fail_count: 0,
      first_failure_at: null,
    } satisfies Record<string, unknown>;
  },
);

const firstElemRequestedPages: number[] = [];
/** Page indices the supplemental serial walk requested (kept out of the above). */
const firstElemSupplementalPages: number[] = [];

function startFirstElemServer(): Promise<{ server: Server; url: string }> {
  const srv = createServer((rawReq, res) => {
    const url = new URL(rawReq.url ?? "/", "http://127.0.0.1");
    if (!url.pathname.startsWith("/api/collections/status/records")) {
      res.statusCode = 404;
      res.end(JSON.stringify({ message: "not found" }));
      return;
    }
    const req = readPbListRequest(url);
    const supplemental = classifyPbListRequest(req) === "supplemental";
    if (req.perPage > 1) {
      if (supplemental) {
        firstElemSupplementalPages.push(req.page);
      } else {
        firstElemRequestedPages.push(req.page);
      }
    }
    // ADVERSARIAL leg (see the block comment above): a BULK request for the
    // page past the short page is answered with POISON rows instead of the
    // empty slice real PB would return, so a merge that does not stop at the
    // short page is observable. Everything else — including the supplemental
    // fetch — is answered faithfully. `alreadyPaged` serves the poison set
    // WHICHEVER page was asked for (it is smaller than one page), while still
    // evaluating `filter`/`sort`/`fields` on it.
    const out =
      !supplemental && req.page >= FIRSTELEM_POISON_FROM_PAGE
        ? evaluatePbList(FIRSTELEM_POISON_ROWS, req, { alreadyPaged: true })
        : evaluatePbList(FIRSTELEM_ROWS, req);
    if (out.status !== 200) {
      res.statusCode = out.status;
      res.setHeader("content-type", "application/json");
      res.end(out.body);
      return;
    }
    setTimeout(() => {
      res.setHeader("content-type", "application/json");
      res.end(out.body);
    }, PAGE_DELAY_MS);
  });
  return new Promise((resolve) => {
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address() as AddressInfo;
      resolve({ server: srv, url: `http://127.0.0.1:${port}` });
    });
  });
}

let firstElemServer: Server;
let firstElemBaseUrl: string;

describe("useLiveStatus (real PocketBase SDK — short page as FIRST wave element)", () => {
  beforeAll(async () => {
    const started = await startFirstElemServer();
    firstElemServer = started.server;
    firstElemBaseUrl = started.url;
  });

  afterAll(() => {
    firstElemServer.close();
  });

  let prevConfig: unknown;
  let hadConfig = false;

  beforeEach(() => {
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
    const win = (
      globalThis as unknown as { window: Window & typeof globalThis }
    ).window as unknown as { __SHOWCASE_CONFIG__?: unknown };
    hadConfig = "__SHOWCASE_CONFIG__" in win;
    prevConfig = win.__SHOWCASE_CONFIG__;
    win.__SHOWCASE_CONFIG__ = {
      pocketbaseUrl: firstElemBaseUrl,
      shellUrl: firstElemBaseUrl,
      opsBaseUrl: firstElemBaseUrl,
    };
    firstElemRequestedPages.length = 0;
    firstElemSupplementalPages.length = 0;
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    const win = (
      globalThis as unknown as { window: Window & typeof globalThis }
    ).window as unknown as { __SHOWCASE_CONFIG__?: unknown };
    if (hadConfig) {
      win.__SHOWCASE_CONFIG__ = prevConfig;
    } else {
      delete win.__SHOWCASE_CONFIG__;
    }
    vi.resetModules();
  });

  it("stops at a short page that is NOT the last wave element, merging no later same-wave page and never arming a second wave", async () => {
    const { useLiveStatus } = await import("./useLiveStatus");
    const { result, unmount } = renderHook(() => useLiveStatus("smoke"));

    try {
      await waitFor(() => expect(result.current.status).toBe("live"), {
        timeout: 5000,
      });
      // Exact total: page 1 (500) + page 2 (200) only. Page 3 was fetched in
      // the same wave and the server answered it with POISON rows, so this
      // length is only reachable if the merge stopped at the short page 2.
      expect(result.current.rows).toHaveLength(FIRSTELEM_TOTAL_ROWS);
      // No duplicates: every id appears exactly once.
      const ids = result.current.rows.map((r) => r.id);
      expect(new Set(ids).size).toBe(FIRSTELEM_TOTAL_ROWS);
      expect(result.current.error).toBeNull();
      // The boundary itself: the LAST merged row is the last row of page 2 —
      // `.at(-1)`, not a `.some()` membership probe, which could not tell a
      // correctly-terminated merge from one that appended page 3 behind it.
      expect(result.current.rows.at(-1)?.id).toBe("f0699");
      // And NOTHING from page 3 was merged. Asserted against the poison ids
      // directly, so this measures the boundary rather than the (real-PB)
      // accident that the page past the end happens to be empty.
      const poisonIds = new Set(FIRSTELEM_POISON_ROWS.map((r) => r.id));
      expect(ids.filter((id) => poisonIds.has(id))).toEqual([]);

      // Over-fetch bound: pages 1, 2, 3 are requested (page 3 rides wave 1 with
      // the short page 2 — the documented batch-2 over-fetch-by-one). The merge
      // must stop at page 2, so NO SECOND wave is armed: page 4+ is NEVER
      // requested. Max requested page is exactly 3. BULK fan-out pages only —
      // the supplemental fetch's serial walk is tracked separately (below), so
      // this bound is not silently satisfied by the other request stream.
      expect(firstElemRequestedPages).toContain(1);
      expect(firstElemRequestedPages).toContain(2);
      expect(firstElemRequestedPages).toContain(3);
      expect(Math.max(...firstElemRequestedPages)).toBe(3);
      expect(firstElemRequestedPages).not.toContain(4);
      // Every fixture row is green, so the supplemental `state != "green"`
      // filter matches nothing and one empty page ends its walk — it can
      // neither pad the row set nor inflate the page bound above.
      expect(firstElemSupplementalPages).toEqual([1]);
    } finally {
      unmount();
    }
  }, 10000);
});
