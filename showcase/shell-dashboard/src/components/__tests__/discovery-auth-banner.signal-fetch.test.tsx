/**
 * REAL-SDK regression test for the DiscoveryAuthBanner self-fetch path.
 *
 * Context: a follow-up trims the INITIAL live-status fetch payload by dropping
 * the heavy `signal` blob from the bulk projection (`STATUS_LIST_FIELDS` in
 * `lib/live-status.ts` = every StatusRow field EXCEPT `signal`). After that
 * change, the `rows` the banner receives from `useLiveStatus` on first paint
 * carry NO `signal`, so the banner can no longer read `cacheStatus`,
 * `sourceName`, or `errorMessage` off the passed-in row list.
 *
 * The banner therefore fetches the `signal` it needs ITSELF via a TARGETED
 * PocketBase query — filtered to exactly the two system keys it renders and
 * projecting only `key,state,signal` — so the detail copy keeps working even
 * when the live row list has no `signal`. This test stands up a real
 * in-process Node http server serving the `status` records endpoint, points
 * the production `getPb()` client at it, renders the banner with `rows` that
 * (like the trimmed initial projection) omit `signal`, and asserts the banner
 * still renders the signal-derived detail copy.
 *
 * It is RED if the banner derives detail copy only from the (signal-less)
 * `rows` prop, and GREEN once it runs the targeted self-fetch.
 *
 * Mirrors the EventSource/localStorage/runtime-config stubbing established by
 * `hooks/useLiveStatus.autocancel.test.tsx` (jsdom lacks the SSE plumbing the
 * SDK constructs, and we point the lazy pb singleton at the fake server URL).
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
import { render, screen, waitFor } from "@testing-library/react";
import { createServer } from "node:http";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import type { StatusRow } from "@/lib/live-status";

// Full server-side rows (WITH signal), keyed by `key`. The fake PB endpoint
// serves these — emulating the live collection, where `signal` IS present
// server-side even though the bulk initial projection drops it on the wire.
const SERVER_ROWS: Record<string, Record<string, unknown>> = {
  "system:discovery-auth-failed": {
    id: "id-auth",
    key: "system:discovery-auth-failed",
    dimension: "system",
    state: "red",
    signal: { cacheStatus: "serving-stale", sourceName: "railway-services" },
    observed_at: "2026-05-14T00:00:00Z",
    transitioned_at: "2026-05-14T00:00:00Z",
    fail_count: 1,
    first_failure_at: "2026-05-14T00:00:00Z",
  },
  "system:browser-pool-degraded": {
    id: "id-bp",
    key: "system:browser-pool-degraded",
    dimension: "system",
    state: "red",
    signal: { errorMessage: "playwright not installed" },
    observed_at: "2026-05-14T00:00:00Z",
    transitioned_at: "2026-05-14T00:00:00Z",
    fail_count: 1,
    first_failure_at: "2026-05-14T00:00:00Z",
  },
};

// Per-key signal override the fake server applies on top of SERVER_ROWS. Tests
// that need to model a server-side signal CHANGE (e.g. the red → green → red
// window in B2) set this to return a fresh signal for the second fetch.
const signalOverrides: Record<string, unknown> = {};

// Records the `perPage` query param of each list request the banner issues, so
// a test can assert the page size tracks the number of keys queried (rather
// than a hard-coded magic number that would silently clip a third key).
const requestedPerPage: number[] = [];

/**
 * Minimal PocketBase-compatible list endpoint. Honours `?filter=` loosely by
 * returning whichever known system rows are named in the (URL-encoded) filter
 * string, and `?fields=` is ignored (the SDK still parses the full objects).
 */
function startPbServer(): Promise<{ server: Server; url: string }> {
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    if (!url.pathname.startsWith("/api/collections/status/records")) {
      res.statusCode = 404;
      res.end(JSON.stringify({ message: "not found" }));
      return;
    }
    const filter = url.searchParams.get("filter") ?? "";
    const rawPerPage = url.searchParams.get("perPage");
    if (rawPerPage !== null && Number.isFinite(Number(rawPerPage)))
      requestedPerPage.push(Number(rawPerPage));
    const items = Object.entries(SERVER_ROWS)
      .filter(([key]) => filter.includes(key))
      .map(([key, row]) =>
        key in signalOverrides ? { ...row, signal: signalOverrides[key] } : row,
      );
    const body = JSON.stringify({
      page: 1,
      perPage: Math.max(1, items.length),
      totalItems: items.length,
      totalPages: 1,
      items,
    });
    res.setHeader("content-type", "application/json");
    res.end(body);
  });
  return new Promise((resolve) => {
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

let prevShowcaseConfig: unknown;
let hadShowcaseConfig = false;

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
  const win = (globalThis as unknown as { window: Window & typeof globalThis })
    .window as unknown as { __SHOWCASE_CONFIG__?: unknown };
  hadShowcaseConfig = "__SHOWCASE_CONFIG__" in win;
  prevShowcaseConfig = win.__SHOWCASE_CONFIG__;
  win.__SHOWCASE_CONFIG__ = {
    pocketbaseUrl: baseUrl,
    shellUrl: baseUrl,
    opsBaseUrl: baseUrl,
  };
  for (const k of Object.keys(signalOverrides)) delete signalOverrides[k];
  requestedPerPage.length = 0;
  vi.resetModules();
});

afterEach(() => {
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

/**
 * A row matching the trimmed INITIAL projection: every StatusRow field EXCEPT
 * `signal`. This is what `useLiveStatus` hands the banner on first paint after
 * the projection drops `signal`. `signal` is set to `undefined` to model its
 * absence from the wire payload.
 *
 * `transitioned_at` is overridable so a test can model a same-key, same-state
 * (still-red) row whose underlying signal content changed server-side: the
 * producer-side state machine bumps `transitioned_at` / `observed_at` when the
 * signal content meaningfully changes, even without a red→green→red state flip.
 */
function projectedRow(
  key: string,
  state: StatusRow["state"],
  transitionedAt = "2026-05-14T00:00:00Z",
): StatusRow {
  return {
    id: `id-${key}`,
    key,
    dimension: "system",
    state,
    // Trimmed projection: signal absent on the initial wire payload.
    signal: undefined,
    observed_at: transitionedAt,
    transitioned_at: transitionedAt,
    fail_count: 1,
    first_failure_at: "2026-05-14T00:00:00Z",
  };
}

describe("DiscoveryAuthBanner (self-fetches signal via targeted PB query)", () => {
  it("renders serving-stale + sourceName copy from a self-fetched signal even when rows omit signal", async () => {
    const { DiscoveryAuthBanner } = await import("../discovery-auth-banner");
    render(
      <DiscoveryAuthBanner
        rows={[projectedRow("system:discovery-auth-failed", "red")]}
      />,
    );
    // The banner must run its own targeted query to learn cacheStatus +
    // sourceName, since the passed-in row has no signal.
    await waitFor(() =>
      expect(
        screen.getByText(
          "Authentication failed for railway-services — serving stale cached data. Refresh tokens to restore live updates.",
        ),
      ).toBeInTheDocument(),
    );
  });

  it("renders browser-pool errorMessage from a self-fetched signal even when rows omit signal", async () => {
    const { DiscoveryAuthBanner } = await import("../discovery-auth-banner");
    render(
      <DiscoveryAuthBanner
        rows={[projectedRow("system:browser-pool-degraded", "red")]}
      />,
    );
    await waitFor(() =>
      expect(
        screen.getByText(
          "Browser pool initialization failed — e2e probes running in degraded mode with stub drivers. (playwright not installed)",
        ),
      ).toBeInTheDocument(),
    );
  });

  // Page-size guard: the targeted fetch's page size must track the NUMBER OF
  // KEYS enumerated in the OR filter (derived from `keys.length`), not a
  // hard-coded magic number. With both system keys red-and-signal-less the
  // fetch enumerates two keys, so it must request `perPage === 2` AND surface
  // both rows' signal-derived copy. A page size that lagged behind the key
  // count (e.g. frozen at 1) would silently clip the second row.
  it("requests a page size equal to the number of keys queried and returns all rows", async () => {
    const { DiscoveryAuthBanner } = await import("../discovery-auth-banner");
    render(
      <DiscoveryAuthBanner
        rows={[
          projectedRow("system:discovery-auth-failed", "red"),
          projectedRow("system:browser-pool-degraded", "red"),
        ]}
      />,
    );
    // Both signal-derived banners must render — neither row clipped.
    await waitFor(() =>
      expect(
        screen.getByText(
          "Authentication failed for railway-services — serving stale cached data. Refresh tokens to restore live updates.",
        ),
      ).toBeInTheDocument(),
    );
    await waitFor(() =>
      expect(
        screen.getByText(
          "Browser pool initialization failed — e2e probes running in degraded mode with stub drivers. (playwright not installed)",
        ),
      ).toBeInTheDocument(),
    );
    // The page size must equal the two keys enumerated in the filter, proving
    // it is derived from `keys.length` rather than a constant.
    expect(requestedPerPage.length).toBeGreaterThan(0);
    expect(requestedPerPage.every((p) => p === 2)).toBe(true);
  });

  // B2 regression: across a red → green → red transition where the new red row
  // hasn't re-fetched its signal yet, the banner must NOT keep serving the
  // STALE signal cached from the FIRST red phase. The fetched-signal cache must
  // be pruned when a key leaves the fetch set (its row clears), so a fresh red
  // either shows the freshly-fetched signal or the base copy — never the prior
  // run's distinctive copy.
  //
  // RED (pre-fix, merge-only cache): after the green clear the stale signal
  // lingers, so the second red instantly re-renders the FIRST phase's
  // "railway-services" copy. GREEN (cache pruned on clear): the stale copy is
  // gone and the banner converges on the SECOND phase's signal.
  it("does not serve the stale fetched signal across a red → green → red flip", async () => {
    const AUTH = "system:discovery-auth-failed";
    const STALE_COPY =
      "Authentication failed for railway-services — serving stale cached data. Refresh tokens to restore live updates.";
    const FRESH_COPY =
      "Authentication failed for vault-tokens — no cached data available. Discovery results may be incomplete.";

    const { DiscoveryAuthBanner } = await import("../discovery-auth-banner");

    // Phase 1 — red: banner self-fetches and renders the FIRST signal's copy.
    const { rerender } = render(
      <DiscoveryAuthBanner rows={[projectedRow(AUTH, "red")]} />,
    );
    await waitFor(() =>
      expect(screen.getByText(STALE_COPY)).toBeInTheDocument(),
    );

    // Phase 2 — green: row clears, banner disappears, fetch set empties so the
    // cached (now stale) signal must be pruned.
    rerender(<DiscoveryAuthBanner rows={[projectedRow(AUTH, "green")]} />);
    await waitFor(() =>
      expect(screen.queryByTestId("discovery-auth-banner")).toBeNull(),
    );

    // The server's signal changes between phases (tokens rotated, still failing
    // but now with no cache). The next fetch must reflect THIS, not the stale
    // phase-1 signal.
    signalOverrides[AUTH] = {
      cacheStatus: "no-cache",
      sourceName: "vault-tokens",
    };

    // Phase 3 — red again, signal-less row (re-fetch pending). This re-render is
    // synchronous; the re-fetch has NOT resolved yet. The assertion below runs
    // in exactly that window. With a merge-only cache the stale phase-1 signal
    // is still present, so `signalFor` serves STALE_COPY immediately. With the
    // cache pruned on the green clear, no cached signal exists, so the banner
    // shows the base/no-signal copy — never STALE_COPY.
    rerender(<DiscoveryAuthBanner rows={[projectedRow(AUTH, "red")]} />);
    // The load-bearing assertion: in the pre-fetch window the stale copy must
    // not appear. (RED pre-fix: it does.)
    expect(screen.queryByText(STALE_COPY)).toBeNull();

    // And once the re-fetch lands, the banner reflects the NEW signal.
    await waitFor(() =>
      expect(screen.getByText(FRESH_COPY)).toBeInTheDocument(),
    );
    expect(screen.queryByText(STALE_COPY)).toBeNull();
  });

  // B3 regression (cache-identity staleness): a banner key STAYS red and
  // signal-less across a server-side signal CONTENT change WITHOUT a
  // red→green→red membership flip. The producer-side state machine bumps the
  // row's `transitioned_at` when the signal content meaningfully changes (still
  // red, but e.g. cacheStatus serving-stale → no-cache, source rotated). Because
  // the set of red-and-signal-less keys (`keysToFetch`) is UNCHANGED, the prior
  // B2 prune does NOT trigger — the cache entry from phase 1 survives. The
  // banner must NOT keep serving the STALE phase-1 copy: it must either
  // re-fetch the new signal or fall back to the base (signal-less) copy, never
  // render the prior signal's distinctive copy for the current failure.
  //
  // RED (pre-fix, prune-timing only): `signalFor` serves `fetched[key]`
  // whenever the live row's `signal === undefined`, with no check that the
  // cached signal was fetched against the CURRENT row identity. The effect is
  // keyed only on `keysToFetch`, which did not change, so no re-fetch fires and
  // the stale phase-1 copy lingers. GREEN (cache tagged with row identity):
  // the cached entry's identity (`id` + `transitioned_at`) no longer matches the
  // advanced row, so it is treated as absent (base copy) and the identity-keyed
  // effect re-fetches the new signal.
  it("does not serve a stale fetched signal when a still-red key's signal content changes", async () => {
    const AUTH = "system:discovery-auth-failed";
    const STALE_COPY =
      "Authentication failed for railway-services — serving stale cached data. Refresh tokens to restore live updates.";
    const FRESH_COPY =
      "Authentication failed for vault-tokens — no cached data available. Discovery results may be incomplete.";

    const { DiscoveryAuthBanner } = await import("../discovery-auth-banner");

    // Phase 1 — red: banner self-fetches and renders the FIRST signal's copy.
    const { rerender } = render(
      <DiscoveryAuthBanner
        rows={[projectedRow(AUTH, "red", "2026-05-14T00:00:00Z")]}
      />,
    );
    await waitFor(() =>
      expect(screen.getByText(STALE_COPY)).toBeInTheDocument(),
    );

    // The server's signal changes while the row STAYS red (no green clear). The
    // producer bumps `transitioned_at`; the set of red-and-signal-less keys is
    // unchanged, so the B2 prune never fires.
    signalOverrides[AUTH] = {
      cacheStatus: "no-cache",
      sourceName: "vault-tokens",
    };

    // Phase 2 — still red, signal-less row, but with an ADVANCED
    // `transitioned_at` reflecting the server-side content change. This
    // re-render is synchronous; any re-fetch has NOT resolved yet. In this
    // window the banner must NOT serve the stale phase-1 copy.
    rerender(
      <DiscoveryAuthBanner
        rows={[projectedRow(AUTH, "red", "2026-05-14T01:00:00Z")]}
      />,
    );
    // The load-bearing assertion: in the pre-fetch window the stale copy must
    // not appear. (RED pre-fix: it does, because the prune never fired.)
    expect(screen.queryByText(STALE_COPY)).toBeNull();

    // And once the identity-keyed re-fetch lands, the banner reflects the NEW
    // signal — never the stale phase-1 copy.
    await waitFor(() =>
      expect(screen.getByText(FRESH_COPY)).toBeInTheDocument(),
    );
    expect(screen.queryByText(STALE_COPY)).toBeNull();
  });
});
