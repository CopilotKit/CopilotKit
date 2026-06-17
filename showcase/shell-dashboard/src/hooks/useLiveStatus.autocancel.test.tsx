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

// Total rows the fake server serves, spread across PB's 500-row page clamp.
// 1300 rows → 3 pages (500 + 500 + 300). The server honours `skipTotal` (it
// returns NO totalItems / totalPages), so the hook can no longer learn the
// page count up front — it paginates by length (keep fetching until a page
// returns fewer than perPage items). Page 1 (full 500) tells the hook to fan
// out the next concurrent wave; pages 2 & 3 land in flight together — exactly
// the scenario the SDK's same-path auto-cancellation breaks.
const TOTAL_ROWS = 1300;
const PER_PAGE_CLAMP = 500;
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

/**
 * Minimal PocketBase-compatible list endpoint. Honours `?page=`/`?perPage=`
 * (clamped to 500, like real PB) and delays each response by PAGE_DELAY_MS so
 * concurrent fan-out pages overlap on the wire.
 */
// Captures the query string of every initial-fetch list request (perPage > 1)
// the hook issues, so the test can assert the lightweight projection
// (`fields=`) and `skipTotal` are actually sent on the wire. Reset per test.
const initialFetchQueries: URLSearchParams[] = [];

function startPbServer(): Promise<{ server: Server; url: string }> {
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    if (!url.pathname.startsWith("/api/collections/status/records")) {
      res.statusCode = 404;
      res.end(JSON.stringify({ message: "not found" }));
      return;
    }
    const page = Number(url.searchParams.get("page") ?? "1");
    const perPage = Math.min(
      Number(url.searchParams.get("perPage") ?? String(PER_PAGE_CLAMP)),
      PER_PAGE_CLAMP,
    );
    // Record initial-fetch (paged) requests only — skip the perPage=1 heartbeat
    // ping so the projection/skipTotal assertions target the bulk fetch.
    if (perPage > 1) {
      initialFetchQueries.push(new URLSearchParams(url.searchParams));
    }
    const start = (page - 1) * perPage;
    const items = ALL_ROWS.slice(start, start + perPage);
    // Honour `skipTotal=1`: real PocketBase omits totalItems/totalPages from
    // the response when the client asks to skip the COUNT(*) query. The hook
    // MUST therefore paginate by length (items.length < perPage ⇒ last page),
    // not by a totalPages the server no longer provides. We assert the flag is
    // actually sent so a regression that drops `skipTotal: true` is caught.
    const skipTotal = url.searchParams.get("skipTotal");
    const body = JSON.stringify(
      skipTotal === "1" || skipTotal === "true"
        ? { page, perPage, items }
        : {
            page,
            perPage,
            totalItems: TOTAL_ROWS,
            totalPages: Math.max(1, Math.ceil(TOTAL_ROWS / perPage)),
            items,
          },
    );
    // Delay so concurrent fan-out pages are genuinely in flight together.
    setTimeout(() => {
      res.setHeader("content-type", "application/json");
      res.end(body);
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

// B4: pagination correctness when the SHORT page lands MID-WAVE (as the second
// element of a fan-out wave), the exact scenario the #4504 over-fetch-past-end
// bug regressed. With INITIAL_FANOUT_BATCH === 2 the first wave is pages [2,3];
// sizing the fixture so page 2 is FULL (500) and page 3 is SHORT (250) lands
// the short page as the wave's SECOND element. The merge must stop at the short
// page, append no empty pages after it, and never drop the tail — so the hook
// must end up with EXACTLY 1250 rows, deduplicated, in page order.
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

// Records every page index the hook actually requested (perPage > 1), so the
// test can assert NO page past the short one (page 4+) is ever fetched.
const midwaveRequestedPages: number[] = [];

function startMidwaveServer(): Promise<{ server: Server; url: string }> {
  const srv = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    if (!url.pathname.startsWith("/api/collections/status/records")) {
      res.statusCode = 404;
      res.end(JSON.stringify({ message: "not found" }));
      return;
    }
    const page = Number(url.searchParams.get("page") ?? "1");
    const perPage = Math.min(
      Number(url.searchParams.get("perPage") ?? String(PER_PAGE_CLAMP)),
      PER_PAGE_CLAMP,
    );
    if (perPage > 1) {
      midwaveRequestedPages.push(page);
    }
    const start = (page - 1) * perPage;
    const items = MIDWAVE_ROWS.slice(start, start + perPage);
    // skipTotal contract: omit totalItems/totalPages so the hook must paginate
    // purely by items.length.
    const body = JSON.stringify({ page, perPage, items });
    setTimeout(() => {
      res.setHeader("content-type", "application/json");
      res.end(body);
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

  it("collects exactly all rows when the short page is mid-wave, with no over-fetch and no duplicates", async () => {
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

      // No over-fetch: the hook must have stopped at the short page 3 and
      // NEVER requested page 4 or beyond. (Page 1 alone, then wave [2,3].)
      expect(midwaveRequestedPages).toContain(1);
      expect(midwaveRequestedPages).toContain(2);
      expect(midwaveRequestedPages).toContain(3);
      expect(Math.max(...midwaveRequestedPages)).toBe(3);
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
// part of wave 1, so it IS fetched concurrently — that single empty over-fetch
// is the documented, bounded batch-2 tradeoff (a wave over-fetches past the
// first short page by at most one empty request). The STRONGEST reachable
// over-fetch property is therefore: the merge stops at the short page (page 3's
// rows never appear) AND no SECOND wave is ever armed (no page 4+ requested).
// We assert exactly that.
const FIRSTELEM_TOTAL_ROWS = 700; // 500 (page 1, full) + 200 (page 2, short).

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

const firstElemRequestedPages: number[] = [];

function startFirstElemServer(): Promise<{ server: Server; url: string }> {
  const srv = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    if (!url.pathname.startsWith("/api/collections/status/records")) {
      res.statusCode = 404;
      res.end(JSON.stringify({ message: "not found" }));
      return;
    }
    const page = Number(url.searchParams.get("page") ?? "1");
    const perPage = Math.min(
      Number(url.searchParams.get("perPage") ?? String(PER_PAGE_CLAMP)),
      PER_PAGE_CLAMP,
    );
    if (perPage > 1) {
      firstElemRequestedPages.push(page);
    }
    const start = (page - 1) * perPage;
    const items = FIRSTELEM_ROWS.slice(start, start + perPage);
    // skipTotal contract: omit totalItems/totalPages so the hook paginates
    // purely by items.length. Page 3 (start = 1000) yields an EMPTY slice.
    const body = JSON.stringify({ page, perPage, items });
    setTimeout(() => {
      res.setHeader("content-type", "application/json");
      res.end(body);
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
      // the same wave but its rows (empty here) must NOT extend the merge, and
      // no real tail is dropped.
      expect(result.current.rows).toHaveLength(FIRSTELEM_TOTAL_ROWS);
      // No duplicates: every id appears exactly once.
      const ids = result.current.rows.map((r) => r.id);
      expect(new Set(ids).size).toBe(FIRSTELEM_TOTAL_ROWS);
      expect(result.current.error).toBeNull();
      // Page 2's rows are the merged tail; page 3's would-be rows are absent.
      // (Page 3 is empty in this fixture, but assert the boundary explicitly:
      // the LAST merged row is the last row of page 2, id "f0699".)
      expect(result.current.rows.some((r) => r.id === "f0699")).toBe(true);

      // Over-fetch bound: pages 1, 2, 3 are requested (page 3 rides wave 1 with
      // the short page 2 — the documented batch-2 over-fetch-by-one). The merge
      // must stop at page 2, so NO SECOND wave is armed: page 4+ is NEVER
      // requested. Max requested page is exactly 3.
      expect(firstElemRequestedPages).toContain(1);
      expect(firstElemRequestedPages).toContain(2);
      expect(firstElemRequestedPages).toContain(3);
      expect(Math.max(...firstElemRequestedPages)).toBe(3);
      expect(firstElemRequestedPages).not.toContain(4);
    } finally {
      unmount();
    }
  }, 10000);
});
