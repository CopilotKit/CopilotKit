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
// 1300 rows → 3 pages (500 + 500 + 300): page 1 reports totalPages, then the
// hook fans out pages 2 & 3 concurrently — exactly the scenario the SDK's
// auto-cancellation breaks.
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
    const start = (page - 1) * perPage;
    const items = ALL_ROWS.slice(start, start + perPage);
    const body = JSON.stringify({
      page,
      perPage,
      totalItems: TOTAL_ROWS,
      totalPages: Math.max(1, Math.ceil(TOTAL_ROWS / perPage)),
      items,
    });
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

beforeEach(() => {
  // jsdom has neither EventSource (PB realtime/SSE) nor a usable localStorage
  // for the SDK's auth store. Stub both so constructing/driving the real
  // PocketBase client doesn't blow up — we never exercise the SSE subscribe
  // path here (the bug under test is in the initial paged fetch).
  (globalThis as unknown as { EventSource: unknown }).EventSource = class {
    close(): void {}
    addEventListener(): void {}
    removeEventListener(): void {}
  };
  const store = new Map<string, string>();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => store.set(k, v),
      removeItem: (k: string) => store.delete(k),
      clear: () => store.clear(),
    },
  });
  // Point the production runtime-config reader at our fake server, then reset
  // the pb module so getPb() rebuilds its singleton against this URL.
  (
    globalThis as unknown as { window: Window & typeof globalThis }
  ).window.__SHOWCASE_CONFIG__ = {
    pocketbaseUrl: baseUrl,
    shellUrl: baseUrl,
    opsBaseUrl: baseUrl,
  };
  vi.resetModules();
});

afterEach(() => {
  vi.resetModules();
});

describe("useLiveStatus (real PocketBase SDK — auto-cancellation regression)", () => {
  it("reaches live with ALL pages despite concurrent same-path fan-out", async () => {
    // Import AFTER resetModules + config injection so the hook closes over a
    // freshly-constructed pb singleton pointed at our fake server.
    const { useLiveStatus } = await import("./useLiveStatus");
    const { result } = renderHook(() => useLiveStatus("smoke"));

    // Without `requestKey: null`, pages 2 & 3 share the page-1 auto request
    // key, get auto-cancelled, Promise.all rejects, and the hook lands in
    // "error" (or never reaches "live") instead. The fix lets every page
    // complete → all 1300 rows → "live".
    await waitFor(() => expect(result.current.status).toBe("live"), {
      timeout: 5000,
    });
    expect(result.current.rows).toHaveLength(TOTAL_ROWS);
    expect(result.current.error).toBeNull();
  }, 10000);
});
