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
 * honour `filter`, `fields`, `sort` and `skipTotal` (see the fidelity helpers
 * below). That is load-bearing, not cosmetic: see the block comment on
 * `matchesPbFilter` for the regression that a filter-IGNORING fake server
 * silently caused.
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
// PocketBase list-endpoint FIDELITY helpers, shared by every fake server below.
//
// Real PocketBase applies `filter`, then `sort`, then the page slice, then the
// `fields` projection, and omits the COUNT(*) envelope when `skipTotal` is set.
// The fakes here must do the same. See `matchesPbFilter` for WHY that is
// load-bearing rather than cosmetic.
// ---------------------------------------------------------------------------

/** The parsed shape of a PocketBase `getList` request's query string. */
interface PbListRequest {
  page: number;
  perPage: number;
  /** `null` when the client sent no filter (⇒ match every row). */
  filter: string | null;
  /** `null` when the client sent no `fields` projection (⇒ return full rows). */
  fields: string | null;
  sort: string | null;
  skipTotal: boolean;
}

/** An absent OR empty query param means "not sent" for our purposes. */
function blankToNull(v: string | null): string | null {
  return v === null || v === "" ? null : v;
}

function readPbListRequest(url: URL): PbListRequest {
  const q = url.searchParams;
  const skipTotal = q.get("skipTotal");
  return {
    page: Number(q.get("page") ?? "1"),
    // PB clamps perPage server-side regardless of what the client asked for.
    perPage: Math.min(
      Number(q.get("perPage") ?? String(PER_PAGE_CLAMP)),
      PER_PAGE_CLAMP,
    ),
    filter: blankToNull(q.get("filter")),
    fields: blankToNull(q.get("fields")),
    sort: blankToNull(q.get("sort")),
    skipTotal: skipTotal === "1" || skipTotal === "true",
  };
}

/**
 * `true` when this request is the hook's SUPPLEMENTAL signal fetch rather than
 * a bulk fan-out page.
 *
 * Discriminated by the ABSENCE of a `fields` projection — the same convention
 * the sibling mocked suite (`useLiveStatus.test.tsx`) uses, and the one
 * property that structurally separates the two: the bulk fetch ALWAYS sends
 * `STATUS_LIST_FIELDS`, while the supplemental fetch sends NO projection
 * because bringing `signal` back is its entire purpose. (Discriminating on a
 * filter substring instead is unreliable — the supplemental filter is a UNION
 * whose comm-error clause is dropped for a dimension scope outside
 * `FLEET_COMM_AGGREGATE_DIMENSIONS`, which is exactly the scope these tests
 * use.) Callers must test the perPage-1 heartbeat ping FIRST: it also sends no
 * projection.
 */
function isSupplementalRequest(req: PbListRequest): boolean {
  return req.perPage > 1 && req.fields === null;
}

/** Thrown when a fake server meets a filter clause the evaluator can't model. */
class PbFilterParseError extends Error {}

interface FilterCursor {
  src: string;
  at: number;
}

function skipFilterWs(c: FilterCursor): void {
  while (c.at < c.src.length && /\s/.test(c.src[c.at]!)) c.at += 1;
}

/**
 * Reads a PocketBase filter VALUE: a single- or double-quoted string (inner
 * quotes backslash-escaped, which is what `pb.filter()` emits — it wraps string
 * params in SINGLE quotes and escapes any embedded `'` as `\'`), or a bare
 * number/boolean literal (`pb.filter()` leaves those unquoted).
 */
function readFilterValue(c: FilterCursor): string {
  skipFilterWs(c);
  const quote = c.src[c.at];
  if (quote === "'" || quote === '"') {
    c.at += 1;
    let out = "";
    while (c.at < c.src.length && c.src[c.at] !== quote) {
      if (c.src[c.at] === "\\") {
        c.at += 1;
        out += c.src[c.at] ?? "";
        c.at += 1;
        continue;
      }
      out += c.src[c.at];
      c.at += 1;
    }
    if (c.src[c.at] !== quote) {
      throw new PbFilterParseError(`unterminated string in filter: ${c.src}`);
    }
    c.at += 1;
    return out;
  }
  let out = "";
  while (c.at < c.src.length && /[^\s)&|]/.test(c.src[c.at]!)) {
    out += c.src[c.at];
    c.at += 1;
  }
  if (out === "") {
    throw new PbFilterParseError(
      `expected a value at offset ${c.at} in filter: ${c.src}`,
    );
  }
  return out;
}

function readFilterIdentifier(c: FilterCursor): string {
  skipFilterWs(c);
  let out = "";
  while (c.at < c.src.length && /[A-Za-z0-9_.]/.test(c.src[c.at]!)) {
    out += c.src[c.at];
    c.at += 1;
  }
  if (out === "") {
    throw new PbFilterParseError(
      `expected a field name at offset ${c.at} in filter: ${c.src}`,
    );
  }
  return out;
}

// Longest-first so `!=` is never mis-read as `!` + `=`.
const PB_FILTER_OPERATORS = ["!=", ">=", "<=", "!~", "=", "~", ">", "<"];

function readFilterOperator(c: FilterCursor): string {
  skipFilterWs(c);
  for (const op of PB_FILTER_OPERATORS) {
    if (c.src.startsWith(op, c.at)) {
      c.at += op.length;
      return op;
    }
  }
  throw new PbFilterParseError(
    `expected an operator at offset ${c.at} in filter: ${c.src}`,
  );
}

/**
 * PocketBase's `~` / `!~` are SQL `LIKE`: `%` matches any run of characters,
 * `_` matches exactly one, matching is case-insensitive, and a pattern with NO
 * `%` is auto-wrapped in `%…%` ("contains"). `key !~ "%/%"` therefore means
 * "the key contains no slash" — the clause that restricts the comm-error
 * supplemental clause to integration-level AGGREGATE keys.
 */
function pbLikeMatches(value: string, pattern: string): boolean {
  const wrapped = pattern.includes("%") ? pattern : `%${pattern}%`;
  const rx = [...wrapped]
    .map((ch) =>
      ch === "%"
        ? ".*"
        : ch === "_"
          ? "."
          : ch.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
    )
    .join("");
  return new RegExp(`^${rx}$`, "i").test(value);
}

function comparePbField(
  actual: unknown,
  op: string,
  expected: string,
): boolean {
  const a = actual === null || actual === undefined ? "" : String(actual);
  switch (op) {
    case "=":
      return a === expected;
    case "!=":
      return a !== expected;
    case "~":
      return pbLikeMatches(a, expected);
    case "!~":
      return !pbLikeMatches(a, expected);
    case ">":
      return a > expected;
    case ">=":
      return a >= expected;
    case "<":
      return a < expected;
    case "<=":
      return a <= expected;
    default:
      throw new PbFilterParseError(`unsupported operator ${op}`);
  }
}

// `a && b` / `a || b` / `(…)` / `field <op> value`. Both sides of an operator
// are always evaluated (never short-circuited) because the parser and the
// evaluator share one pass — skipping a branch would desynchronize the cursor.
function evalFilterPrimary(
  c: FilterCursor,
  row: Record<string, unknown>,
): boolean {
  skipFilterWs(c);
  if (c.src[c.at] === "(") {
    c.at += 1;
    const inner = evalFilterOr(c, row);
    skipFilterWs(c);
    if (c.src[c.at] !== ")") {
      throw new PbFilterParseError(
        `unbalanced parenthesis in filter: ${c.src}`,
      );
    }
    c.at += 1;
    return inner;
  }
  const field = readFilterIdentifier(c);
  const op = readFilterOperator(c);
  const value = readFilterValue(c);
  return comparePbField(row[field], op, value);
}

function evalFilterAnd(c: FilterCursor, row: Record<string, unknown>): boolean {
  let acc = evalFilterPrimary(c, row);
  for (;;) {
    skipFilterWs(c);
    if (!c.src.startsWith("&&", c.at)) return acc;
    c.at += 2;
    const rhs = evalFilterPrimary(c, row);
    acc = acc && rhs;
  }
}

function evalFilterOr(c: FilterCursor, row: Record<string, unknown>): boolean {
  let acc = evalFilterAnd(c, row);
  for (;;) {
    skipFilterWs(c);
    if (!c.src.startsWith("||", c.at)) return acc;
    c.at += 2;
    const rhs = evalFilterAnd(c, row);
    acc = acc || rhs;
  }
}

/**
 * Evaluates a PocketBase `?filter=` expression against one row.
 *
 * WHY THIS EXISTS — the regression it closes. PR #6156 made the SUPPLEMENTAL
 * `signal` fetch UNCONDITIONAL (it dropped the "skip when the dimension scope
 * is outside the comm-error aggregate set" early return and widened the filter
 * to `state != "green"`). The fake servers in this file used to IGNORE `filter`
 * entirely, so that now-always-issued fetch was answered with the ENTIRE
 * dataset — and `fetchInitial` APPENDS every supplemental row the bulk pages
 * did not carry. A filter-ignoring server therefore silently REPAIRED whatever
 * rows the bulk pagination dropped, which disarmed the #4504 dropped-tail
 * guards this whole file exists to hold: mutating the merge to drop the ENTIRE
 * short page kept all three tests GREEN.
 *
 * Honouring the filter is what puts the teeth back. These fixtures are all
 * `state: "green"`, and the hook's supplemental filter for an out-of-aggregate
 * dimension scope is `dimension = 'smoke' && (state != "green")` — which
 * matches NOTHING. The bulk fan-out is then on its own and any dropped tail is
 * fatal, as it must be.
 *
 * The grammar covered is exactly what `useLiveStatus` emits (`=`/`!=`/`~`/`!~`
 * plus `&&`/`||`/parens over quoted or bare literals). Anything else THROWS
 * rather than degrading to "match everything" — a silently-unparsed clause
 * would put us straight back into the masking bug, so the fake fails loud.
 */
function matchesPbFilter(
  row: Record<string, unknown>,
  filter: string | null,
): boolean {
  if (filter === null) return true;
  const c: FilterCursor = { src: filter, at: 0 };
  const verdict = evalFilterOr(c, row);
  skipFilterWs(c);
  if (c.at !== filter.length) {
    throw new PbFilterParseError(
      `trailing input at offset ${c.at} in filter: ${filter}`,
    );
  }
  return verdict;
}

/**
 * Applies PocketBase's `?fields=` projection: only the listed keys survive.
 * Load-bearing here because the bulk initial fetch projects the heavy `signal`
 * blob away (`STATUS_LIST_FIELDS`) — a fake that returns full rows to the bulk
 * fetch is how the CF7-F3 cold-load overlay bug stayed invisible to the
 * sibling suite.
 */
function projectPbFields(
  row: Record<string, unknown>,
  fields: string | null,
): Record<string, unknown> {
  if (fields === null) return row;
  const allow = fields
    .split(",")
    .map((f) => f.trim())
    .filter((f) => f !== "");
  const out: Record<string, unknown> = {};
  for (const key of allow) {
    if (key in row) out[key] = row[key];
  }
  return out;
}

/** PocketBase's `?sort=` (single key, optional `-` for DESC). */
function sortPbRows(
  rows: readonly Record<string, unknown>[],
  sort: string,
): Record<string, unknown>[] {
  const desc = sort.startsWith("-");
  const key = desc ? sort.slice(1) : sort.replace(/^\+/, "");
  return [...rows].sort((a, b) => {
    const av = String(a[key] ?? "");
    const bv = String(b[key] ?? "");
    const cmp = av < bv ? -1 : av > bv ? 1 : 0;
    return desc ? -cmp : cmp;
  });
}

/** The rows of `dataset` this request's `filter` selects (pre-pagination). */
function pbMatchingRows(
  dataset: readonly Record<string, unknown>[],
  req: PbListRequest,
): Record<string, unknown>[] {
  return dataset.filter((row) => matchesPbFilter(row, req.filter));
}

/** The page slice of already-filtered rows, ordered by the request's `sort`. */
function pbPageSlice(
  matching: readonly Record<string, unknown>[],
  req: PbListRequest,
): Record<string, unknown>[] {
  const ordered =
    req.sort === null ? [...matching] : sortPbRows(matching, req.sort);
  const start = (req.page - 1) * req.perPage;
  return ordered.slice(start, start + req.perPage);
}

/**
 * Serializes a PocketBase list response: `fields`-projected items, and the
 * COUNT(*) envelope (`totalItems`/`totalPages`) ONLY when the client did not
 * ask to skip it. Honouring `skipTotal` is what forces the hook to paginate by
 * `items.length` rather than a `totalPages` it can no longer see.
 */
function pbListBody(
  items: readonly Record<string, unknown>[],
  req: PbListRequest,
  matchedTotal: number,
): string {
  const projected = items.map((row) => projectPbFields(row, req.fields));
  if (req.skipTotal) {
    return JSON.stringify({
      page: req.page,
      perPage: req.perPage,
      items: projected,
    });
  }
  return JSON.stringify({
    page: req.page,
    perPage: req.perPage,
    totalItems: matchedTotal,
    totalPages: Math.max(1, Math.ceil(matchedTotal / req.perPage)),
    items: projected,
  });
}

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

// Captures the query string of every BULK initial-fetch list request the hook
// issues, so the test can assert the lightweight projection (`fields=`) and
// `skipTotal` are actually sent on the wire. Reset per test.
const initialFetchQueries: URLSearchParams[] = [];
/** The supplemental signal fetch's queries (unprojected — see the split below). */
const supplementalQueries: URLSearchParams[] = [];

/**
 * Minimal but FAITHFUL PocketBase list endpoint: honours `?page=`/`?perPage=`
 * (clamped to 500, like real PB), `?filter=`, `?fields=`, `?sort=` and
 * `?skipTotal=` (see the fidelity helpers above), and delays each response by
 * PAGE_DELAY_MS so concurrent fan-out pages overlap on the wire.
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
    // the bulk pages (it deliberately sends NO `fields` projection, so folding
    // it in would fail the "every bulk page projects `signal` away" assertion).
    if (req.perPage > 1) {
      const q = new URLSearchParams(url.searchParams);
      if (isSupplementalRequest(req)) {
        supplementalQueries.push(q);
      } else {
        initialFetchQueries.push(q);
      }
    }
    let body: string;
    try {
      const matching = pbMatchingRows(ALL_ROWS, req);
      body = pbListBody(pbPageSlice(matching, req), req, matching.length);
    } catch (err) {
      // A filter clause the evaluator cannot model is a HARD failure, never a
      // silent match-everything (see `matchesPbFilter`). Surface it as a 400 so
      // the SDK rejects, the hook lands in "error", and the test fails loudly
      // with the parse message rather than passing on a fake's blind spot.
      res.statusCode = 400;
      res.end(JSON.stringify({ message: String(err) }));
      return;
    }
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
      // see the actual query string. Unprojected is load-bearing: with a
      // `fields=` list PocketBase would omit `signal` and the classifier would
      // be back to guessing why a rung failed.
      expect(supplementalQueries.length).toBeGreaterThan(0);
      for (const q of supplementalQueries) {
        expect(q.get("fields")).toBeNull();
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
      // (see `matchesPbFilter`). ALL 1300 rows above therefore came from the
      // bulk fan-out alone.
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
      if (isSupplementalRequest(req)) {
        midwaveSupplementalPages.push(req.page);
      } else {
        midwaveRequestedPages.push(req.page);
      }
    }
    let body: string;
    try {
      const matching = pbMatchingRows(MIDWAVE_ROWS, req);
      body = pbListBody(pbPageSlice(matching, req), req, matching.length);
    } catch (err) {
      res.statusCode = 400;
      res.end(JSON.stringify({ message: String(err) }));
      return;
    }
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
    const supplemental = isSupplementalRequest(req);
    if (req.perPage > 1) {
      if (supplemental) {
        firstElemSupplementalPages.push(req.page);
      } else {
        firstElemRequestedPages.push(req.page);
      }
    }
    let body: string;
    try {
      // ADVERSARIAL leg (see the block comment above): a BULK request for the
      // page past the short page is answered with POISON rows instead of the
      // empty slice real PB would return, so a merge that does not stop at the
      // short page is observable. Everything else — including the supplemental
      // fetch — is answered faithfully.
      if (!supplemental && req.page >= FIRSTELEM_POISON_FROM_PAGE) {
        const poison = pbMatchingRows(FIRSTELEM_POISON_ROWS, req);
        body = pbListBody(poison.slice(0, req.perPage), req, poison.length);
      } else {
        const matching = pbMatchingRows(FIRSTELEM_ROWS, req);
        body = pbListBody(pbPageSlice(matching, req), req, matching.length);
      }
    } catch (err) {
      res.statusCode = 400;
      res.end(JSON.stringify({ message: String(err) }));
      return;
    }
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
