/**
 * REAL-SDK test for CellDrilldown's lazy `signal` fetch.
 *
 * Phase 0 dropped the heavy `signal` blob from the INITIAL status fetch
 * projection (STATUS_LIST_FIELDS in lib/live-status.ts): rows that land in the
 * live grid no longer carry `signal`. The drilldown is exactly where the full
 * `signal` payload IS needed (the per-badge failure metadata + raw-signal
 * collapsible). So when a cell's drilldown opens, it must LAZY-LOAD the
 * `signal` for the failing badges' records on demand rather than expecting it
 * to already be present on the row.
 *
 * This test stands up a real in-process Node http server that serves the
 * status records endpoint (a targeted `getList` filtered by record id with
 * `fields=id,signal`), points the PRODUCTION `getPb()` client at it, renders
 * the REAL CellDrilldown with signal-LESS rows, and asserts the panel fetches
 * + renders the lazy-loaded signal fields.
 *
 * NOTE: like useLiveStatus.autocancel.test.tsx, this file does NOT mock
 * `../../lib/pb` — it drives the real SDK against a real socket. EventSource +
 * localStorage are stubbed because jsdom lacks them and the SDK touches both at
 * construction time.
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
import { render, waitFor, within } from "@testing-library/react";
import { createServer } from "node:http";
import type { Server, IncomingMessage } from "node:http";
import type { AddressInfo } from "node:net";
import type { LiveStatusMap, StatusRow } from "@/lib/live-status";

/** Build a signal-LESS row (mirrors the projected initial fetch). */
function rowNoSignal(
  key: string,
  dimension: string,
  state: StatusRow["state"],
  overrides?: Partial<StatusRow>,
): StatusRow {
  return {
    id: `id-${key}`,
    key,
    dimension,
    state,
    // The whole point: signal is absent/undefined on the projected row.
    signal: undefined,
    observed_at: "2026-04-20T00:00:00Z",
    transitioned_at: "2026-04-20T00:00:00Z",
    fail_count: 1,
    first_failure_at: "2026-04-19T10:00:00Z",
    ...overrides,
  };
}

function mapOf(rows: StatusRow[]): LiveStatusMap {
  const m: LiveStatusMap = new Map();
  for (const r of rows) m.set(r.key, r);
  return m;
}

/**
 * The server-side `signal` blobs keyed by record id. The drilldown fetches
 * these on demand.
 */
const SIGNAL_BY_ID: Record<string, unknown> = {
  "id-e2e:lgp/agentic-chat": {
    errorDesc: "Agent returned empty response",
    backendUrl: "https://lgp.example.com",
    apiRequestCount: 3,
  },
};

/** Tracks the requests the server received so we can assert the query shape. */
const receivedRequests: Array<{ pathname: string; search: string }> = [];

/** When true, the server responds 500 so we can drive the error path. */
let failNext = false;

/**
 * When non-null, the server returns ONLY these items (ignoring SIGNAL_BY_ID).
 * Lets a test drive a PARTIAL result — a 200 where a requested id is absent
 * from the response (the record was deleted server-side between grid fetch and
 * drilldown open).
 */
let respondWithItems: Array<{ id: string; signal: unknown }> | null = null;

/**
 * Minimal PocketBase-compatible list endpoint. Returns the records matching
 * the requested ids, projecting only the fields requested (we only care that
 * `signal` is honoured here).
 */
function startPbServer(): Promise<{ server: Server; url: string }> {
  const server = createServer((req: IncomingMessage, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    if (!url.pathname.startsWith("/api/collections/status/records")) {
      res.statusCode = 404;
      res.end(JSON.stringify({ message: "not found" }));
      return;
    }
    receivedRequests.push({
      pathname: url.pathname,
      search: url.search,
    });
    if (failNext) {
      res.statusCode = 500;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ message: "boom" }));
      return;
    }
    const items =
      respondWithItems ??
      Object.entries(SIGNAL_BY_ID).map(([id, signal]) => ({
        id,
        signal,
      }));
    res.setHeader("content-type", "application/json");
    res.end(
      JSON.stringify({
        page: 1,
        perPage: 500,
        totalItems: items.length,
        totalPages: 1,
        items,
      }),
    );
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
  receivedRequests.length = 0;
  failNext = false;
  respondWithItems = null;
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

describe("CellDrilldown — lazy signal fetch (real PocketBase SDK)", () => {
  it("lazy-loads and renders signal fields for a failing badge whose row has no signal", async () => {
    // Import AFTER resetModules + config injection so the component closes over
    // a freshly-constructed pb singleton pointed at our fake server.
    const { CellDrilldown } = await import("../cell-drilldown");
    const live = mapOf([rowNoSignal("e2e:lgp/agentic-chat", "e2e", "red")]);

    const { getByTestId } = render(
      <CellDrilldown
        slug="lgp"
        featureId="agentic-chat"
        integrationName="LangGraph Python"
        featureName="Agentic Chat"
        liveStatus={live}
        onClose={() => {}}
      />,
    );

    // The signal fields are NOT in the row, so they must be fetched on demand.
    await waitFor(
      () => {
        expect(getByTestId("signal-field-error").textContent).toBe(
          "Agent returned empty response",
        );
      },
      { timeout: 5000 },
    );
    expect(getByTestId("signal-field-backend-url").textContent).toBe(
      "https://lgp.example.com",
    );
    expect(getByTestId("signal-field-api-requests").textContent).toBe("3");

    // The lazy fetch requested only id+signal, filtered to the failing record.
    expect(receivedRequests.length).toBeGreaterThan(0);
    const search = receivedRequests[0]!.search;
    expect(decodeURIComponent(search)).toContain("signal");
    expect(decodeURIComponent(search)).toContain("id-e2e:lgp/agentic-chat");
  }, 10000);

  it("does not fetch when there are no failing badges (all green / no data)", async () => {
    const { CellDrilldown } = await import("../cell-drilldown");
    const { getByTestId } = render(
      <CellDrilldown
        slug="lgp"
        featureId="agentic-chat"
        integrationName="LangGraph Python"
        featureName="Agentic Chat"
        liveStatus={new Map()}
        onClose={() => {}}
      />,
    );
    expect(getByTestId("cell-drilldown")).toBeDefined();
    // Give any errant async fetch a chance to land, then assert none happened.
    await new Promise((r) => setTimeout(r, 50));
    expect(receivedRequests.length).toBe(0);
  }, 10000);

  it("degrades gracefully when the lazy signal fetch fails (no crash, error affordance)", async () => {
    failNext = true;
    const { CellDrilldown } = await import("../cell-drilldown");
    const live = mapOf([rowNoSignal("e2e:lgp/agentic-chat", "e2e", "red")]);

    const { getByTestId, queryByTestId } = render(
      <CellDrilldown
        slug="lgp"
        featureId="agentic-chat"
        integrationName="LangGraph Python"
        featureName="Agentic Chat"
        liveStatus={live}
        onClose={() => {}}
      />,
    );

    // The panel still renders (fail_count / first_failure metadata is present),
    // and an inline error affordance appears instead of crashing.
    await waitFor(() => expect(getByTestId("signal-error")).toBeDefined(), {
      timeout: 5000,
    });
    expect(getByTestId("cell-drilldown")).toBeDefined();
    // The failing badge still shows its fail_count (non-signal metadata).
    expect(getByTestId("fail-count").textContent).toBe("1");
    // No signal fields rendered since the fetch failed.
    expect(queryByTestId("signal-field-error")).toBeNull();
  }, 10000);

  it("prefers a row's own signal over a lazy fetch (no fetch when signal present)", async () => {
    const { CellDrilldown } = await import("../cell-drilldown");
    const live = mapOf([
      rowNoSignal("e2e:lgp/agentic-chat", "e2e", "red", {
        signal: { error: "inline signal already here" },
      }),
    ]);

    const { getByTestId } = render(
      <CellDrilldown
        slug="lgp"
        featureId="agentic-chat"
        integrationName="LangGraph Python"
        featureName="Agentic Chat"
        liveStatus={live}
        onClose={() => {}}
      />,
    );

    expect(getByTestId("signal-field-error").textContent).toBe(
      "inline signal already here",
    );
    // Row already carried a signal → no lazy fetch should have fired.
    await new Promise((r) => setTimeout(r, 50));
    expect(receivedRequests.length).toBe(0);
  }, 10000);

  // A3: the loading/error affordance must be PER-BADGE — a badge whose signal
  // arrived must NOT show the error even though a SIBLING badge in the same
  // batched fetch failed to resolve. The shared `lazy.error`/`lazy.loading`
  // flag cannot express this (it would paint both badges identically).
  it("resolves loading/error per badge — a badge whose signal arrived shows no error even when a sibling badge in the same fetch did not resolve", async () => {
    // Two signal-LESS failing badges in the SAME cell, so BOTH are batched into
    // one lazy fetch:
    //   - health:lgp           (id-health:lgp)
    //   - e2e:lgp/agentic-chat (id-e2e:lgp/agentic-chat)
    // The 200 response carries ONLY the e2e record. The shared-flag approach
    // would see loading=false / error=null for BOTH and render NOTHING for the
    // health badge; per-badge resolution must instead surface health's error.
    respondWithItems = [
      {
        id: "id-e2e:lgp/agentic-chat",
        signal: { error: "resolved e2e failure" },
      },
    ];
    const { CellDrilldown } = await import("../cell-drilldown");
    const live = mapOf([
      rowNoSignal("health:lgp", "health", "red"),
      rowNoSignal("e2e:lgp/agentic-chat", "e2e", "red"),
    ]);

    const { getByTestId } = render(
      <CellDrilldown
        slug="lgp"
        featureId="agentic-chat"
        integrationName="LangGraph Python"
        featureName="Agentic Chat"
        liveStatus={live}
        onClose={() => {}}
      />,
    );

    const healthBadge = getByTestId("drilldown-badge-health");
    // The e2e row's label-derived testid: `BE (Agent)` now belongs to
    // the D4 row (whose fixtures here have no chat/tools data), so the e2e
    // row must be selected via its renamed `UI (Frontend)` label.
    const e2eBadge = getByTestId("drilldown-badge-ui--frontend-");

    // The e2e badge's signal arrived → it renders its field and shows NO error.
    await waitFor(
      () =>
        expect(
          within(e2eBadge).getByTestId("signal-field-error").textContent,
        ).toBe("resolved e2e failure"),
      { timeout: 5000 },
    );
    expect(within(e2eBadge).queryByTestId("signal-error")).toBeNull();

    // The health badge was requested but absent from the response → its error
    // affordance must show, even though the SHARED flag is loading=false/no-error.
    expect(within(healthBadge).getByTestId("signal-error")).toBeDefined();
    expect(within(healthBadge).queryByTestId("signal-field-error")).toBeNull();
  }, 10000);

  // A stale-green DOWNGRADE (a passing green row whose `observed_at` aged past
  // the staleness window, which `buildBadge` paints amber/degraded) is NOT a
  // genuine failure: there is no failure `signal` server-side. It must NOT be
  // lazy-fetched and must NOT surface the couldn't-load affordance — its only
  // issue is staleness, not failure.
  it("does not fetch or show an error affordance for a staleness-downgraded green badge (amber tone, fail_count 0, no signal)", async () => {
    const { CellDrilldown } = await import("../cell-drilldown");
    // A green e2e row whose observed_at is far in the past → buildBadge
    // downgrades it to amber via the E2E (6h) staleness window. It passed
    // (green), so fail_count === 0 and first_failure_at === null.
    const live = mapOf([
      rowNoSignal("e2e:lgp/agentic-chat", "e2e", "green", {
        observed_at: "2020-01-01T00:00:00Z",
        fail_count: 0,
        first_failure_at: null,
      }),
    ]);

    const { getByTestId, queryByTestId } = render(
      <CellDrilldown
        slug="lgp"
        featureId="agentic-chat"
        integrationName="LangGraph Python"
        featureName="Agentic Chat"
        liveStatus={live}
        onClose={() => {}}
      />,
    );

    expect(getByTestId("cell-drilldown")).toBeDefined();
    // Give any errant async fetch a chance to land, then assert none happened
    // and no couldn't-load affordance was rendered for the stale-green badge.
    await new Promise((r) => setTimeout(r, 50));
    expect(receivedRequests.length).toBe(0);
    expect(queryByTestId("signal-error")).toBeNull();
  }, 10000);

  // The counterpart to the stale-green case: a GENUINE degraded row (amber tone
  // with fail_count > 0) is a real failure and MUST still lazy-fetch its signal
  // and surface the couldn't-load affordance on a missing record.
  it("still fetches and surfaces the error affordance for a genuine amber failure (fail_count > 0)", async () => {
    respondWithItems = []; // 200 with no items → partial failure for the row.
    const { CellDrilldown } = await import("../cell-drilldown");
    const live = mapOf([
      rowNoSignal("e2e:lgp/agentic-chat", "e2e", "degraded", {
        fail_count: 2,
      }),
    ]);

    const { getByTestId } = render(
      <CellDrilldown
        slug="lgp"
        featureId="agentic-chat"
        integrationName="LangGraph Python"
        featureName="Agentic Chat"
        liveStatus={live}
        onClose={() => {}}
      />,
    );

    // e2e row selected via its renamed `UI (Frontend)` label — see above.
    const e2eBadge = getByTestId("drilldown-badge-ui--frontend-");
    await waitFor(
      () => expect(within(e2eBadge).getByTestId("signal-error")).toBeDefined(),
      { timeout: 5000 },
    );
    // The genuine failure WAS lazy-fetched.
    expect(receivedRequests.length).toBeGreaterThan(0);
  }, 10000);

  // A displayed signal field that the producer emits as an OBJECT (or array)
  // must render a JSON representation — NOT the useless "[object Object]" that
  // `String(val)` yields, which would pass the non-empty guard and render
  // garbage. e.g. `step: { name, index }`.
  it("renders a JSON representation for an object-valued signal field, not [object Object]", async () => {
    respondWithItems = [
      {
        id: "id-e2e:lgp/agentic-chat",
        signal: {
          failureSummary: "build failed",
          step: { name: "build", index: 2 },
        },
      },
    ];
    const { CellDrilldown } = await import("../cell-drilldown");
    const live = mapOf([rowNoSignal("e2e:lgp/agentic-chat", "e2e", "red")]);

    const { getByTestId } = render(
      <CellDrilldown
        slug="lgp"
        featureId="agentic-chat"
        integrationName="LangGraph Python"
        featureName="Agentic Chat"
        liveStatus={live}
        onClose={() => {}}
      />,
    );

    await waitFor(
      () => {
        expect(getByTestId("signal-field-step").textContent).toBe(
          '{"name":"build","index":2}',
        );
      },
      { timeout: 5000 },
    );
    // The garbage string must never appear.
    expect(getByTestId("signal-field-step").textContent).not.toContain(
      "[object Object]",
    );
    // Primitive sibling field still renders as a plain string.
    expect(getByTestId("signal-field-failure").textContent).toBe(
      "build failed",
    );
  }, 10000);

  // A3: a PARTIAL result (an id requested but absent from the 200 response,
  // e.g. deleted server-side) must surface the couldn't-load affordance rather
  // than silently rendering nothing.
  it("on a partial result (a requested id missing from the response), the affected badge shows the couldn't-load affordance instead of nothing", async () => {
    // 200 OK, but the response contains NO item for the requested health id —
    // simulating the record having been deleted between grid fetch and open.
    respondWithItems = [];
    const { CellDrilldown } = await import("../cell-drilldown");
    const live = mapOf([rowNoSignal("health:lgp", "health", "red")]);

    const { getByTestId } = render(
      <CellDrilldown
        slug="lgp"
        featureId="agentic-chat"
        integrationName="LangGraph Python"
        featureName="Agentic Chat"
        liveStatus={live}
        onClose={() => {}}
      />,
    );

    const healthBadge = getByTestId("drilldown-badge-health");

    // The fetch settled (no error) but the id never came back → the partial
    // failure must be visible via the couldn't-load affordance, not silent.
    await waitFor(
      () =>
        expect(within(healthBadge).getByTestId("signal-error")).toBeDefined(),
      { timeout: 5000 },
    );
    // And no signal fields rendered (there was no signal to render).
    expect(within(healthBadge).queryByTestId("signal-field-error")).toBeNull();
  }, 10000);
});
