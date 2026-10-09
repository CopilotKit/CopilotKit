/**
 * BOUNDARY tests for the initial-fetch page cap and the `truncated` contract in
 * `useLiveStatus`.
 *
 * THE BUG THESE PIN. Both initial fetches paginate by LENGTH — `skipTotal: true`
 * drops `totalItems`/`totalPages`, so the loop learns where the collection ends
 * only from a SHORT page. That leaves ONE ambiguous state: the cap is exhausted
 * and the last page in it was FULL. A collection of exactly
 * `MAX_INITIAL_FETCH_PAGES × 500` rows is read COMPLETELY and lands in exactly
 * that state, indistinguishable from a collection with more to give.
 *
 * Reporting that state as `truncated` is a FALSE POSITIVE, and it is not
 * cosmetic: the BULK caller THROWS on truncation (unread rows are whole cells,
 * which render as no-data GRAY — the masking polarity this file exists to
 * eliminate), so at exactly 10,000 rows the dashboard went offline
 * DETERMINISTICALLY and PERMANENTLY — every retry, every reload — because the
 * condition is a pure function of the row count. `/api/matrix` had the same
 * false-outage class server-side (any full final page read as truncation ⇒ any
 * 500-boundary took the route down) and fixed it with `totalItems`.
 *
 * So `truncated` must mean exactly "there are rows we did not read", and must be
 * PROVEN rather than inferred — `paginateStatusPages` proves it with one
 * lookahead read of page `MAX_INITIAL_FETCH_PAGES + 1` whose rows are discarded
 * and only whose emptiness is load-bearing.
 *
 * BOTH DIRECTIONS ARE TESTED HERE. A `truncated` that never fires is exactly as
 * wrong as one that always does: it would let the bulk path paint a partial
 * matrix as complete, which is the original masking bug. So every "complete read
 * ⇒ not truncated" case below has a "+1 row ⇒ truncated" twin.
 *
 * WHY THIS FILE HAS ITS OWN FAKE. The boundary needs 10,000 rows in the BULK
 * response, which no shared fixture serves, and the assertions must not depend
 * on the fidelity of the `__tests__/pb-query-eval` fake servers (filter/sort
 * evaluation is being repaired in parallel). Everything here runs against a
 * local `../lib/pb` mock declared in this file plus DIRECT calls into
 * `paginateStatusPages`, so nothing it proves can be undone — or faked green —
 * by a change to those servers.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import type { StatusRow } from "../lib/live-status";

/** PocketBase clamps `perPage` server-side; the hook's page size. */
const PB_PAGE_SIZE = 500;

/**
 * The cap under test. Pinned MECHANICALLY against the exported constant in the
 * first test below, so this literal cannot drift from the implementation in
 * either direction.
 */
const CAP = 20;

const mockState = {
  /** Rows the BULK query is served from (paged, 500/page). */
  bulkRows: [] as StatusRow[],
  /** Rows the SUPPLEMENTAL (signal-bearing) query is served from. */
  supplementalRows: [] as StatusRow[],
  bulkPages: [] as number[],
  supplementalPages: [] as number[],
};

/** The 500-row page slice PocketBase would serve for `pageNo`. */
function page<T>(rows: T[], pageNo: number): T[] {
  const start = (pageNo - 1) * PB_PAGE_SIZE;
  return rows.slice(start, start + PB_PAGE_SIZE);
}

vi.mock("../lib/pb", () => {
  const pb = {
    filter: (raw: string, params?: Record<string, unknown>) => {
      let out = raw;
      if (params) {
        for (const [k, v] of Object.entries(params)) {
          out = out.replace(new RegExp(`\\{:${k}\\}`, "g"), JSON.stringify(v));
        }
      }
      return out;
    },
    collection: (_name: string) => ({
      getList: vi.fn(
        async (
          pageNo: number,
          perPage: number,
          opts?: { fields?: string },
        ): Promise<{ items: unknown[]; page: number; perPage: number }> => {
          // Heartbeat ping (perPage 1) — never part of either page loop.
          if (perPage === 1) {
            return { items: [], page: 1, perPage: 1 };
          }
          // Same discriminator the sibling suites use: the supplemental fetch is
          // THE request that asks for the heavy `signal` blob; the bulk fetch
          // always projects it away.
          const fields = opts?.fields;
          if (fields === undefined || fields.split(",").includes("signal")) {
            mockState.supplementalPages.push(pageNo);
            return {
              items: page(mockState.supplementalRows, pageNo),
              page: pageNo,
              perPage,
            };
          }
          mockState.bulkPages.push(pageNo);
          // Honour the projection like real PB: the bulk rows must arrive
          // WITHOUT `signal`, which is what makes the fail-safe red polarity
          // below a real assertion rather than an artifact of the fake.
          return {
            items: page(mockState.bulkRows, pageNo).map(
              ({ signal: _signal, ...rest }) => rest,
            ),
            page: pageNo,
            perPage,
          };
        },
      ),
      subscribe: vi.fn(async () => async () => {}),
      unsubscribe: vi.fn(async () => {}),
    }),
  };
  return {
    pbIsMisconfigured: () => false,
    PB_MISCONFIG_MESSAGE: "Dashboard misconfigured (test stub)",
    getPb: () => pb,
  };
});

const hookModule = await import("./useLiveStatus");
const { useLiveStatus } = hookModule;

const { buildCellModel } = await import("../lib/cell-model");
const { keyFor, mergeRowsToMap } = await import("../lib/live-status");

const NOW_MS = Date.parse("2026-06-04T12:00:00.000Z");
const OBSERVED_ISO = "2026-06-04T11:59:30.000Z";
const RED_SLUG = "acme";
const FEATURE = "beautiful-chat";

/**
 * `n` rows, the FIRST of which is a genuinely-failing per-cell e2e row. The red
 * row is what makes "the dashboard renders" mean something: a complete read at
 * the boundary must still paint that cell RED, not blank the matrix and not
 * paint it gray.
 */
function rowsFixture(n: number): StatusRow[] {
  return Array.from({ length: n }, (_, i) =>
    i === 0
      ? {
          id: "r000000",
          key: keyFor("e2e", RED_SLUG, FEATURE),
          dimension: "e2e",
          state: "red",
          signal: { errorClass: "assertion-failed" },
          observed_at: OBSERVED_ISO,
          transitioned_at: OBSERVED_ISO,
          fail_count: 4,
          first_failure_at: OBSERVED_ISO,
        }
      : {
          id: `r${String(i).padStart(6, "0")}`,
          key: `d5:cap/f${i}`,
          dimension: "d5",
          state: "green",
          signal: { note: "filler" },
          observed_at: OBSERVED_ISO,
          transitioned_at: OBSERVED_ISO,
          fail_count: 0,
          first_failure_at: null,
        },
  );
}

/** Pages 1..CAP followed by the ONE terminal lookahead at CAP+1. */
const PAGES_THROUGH_LOOKAHEAD = Array.from(
  { length: CAP + 1 },
  (_, i) => i + 1,
);

beforeEach(() => {
  mockState.bulkRows = [];
  mockState.supplementalRows = [];
  mockState.bulkPages = [];
  mockState.supplementalPages = [];
});

// ---------------------------------------------------------------------------
// 1. DIRECT assertions on the `truncated` contract
// ---------------------------------------------------------------------------

describe("paginateStatusPages — `truncated` means 'rows we did not read'", () => {
  /** A reader over `total` rows that records every page it was asked for. */
  function readerOver(
    total: number,
    issued: number[],
  ): (pageNo: number) => Promise<StatusRow[]> {
    const rows = rowsFixture(total);
    return async (pageNo: number) => {
      issued.push(pageNo);
      return page(rows, pageNo);
    };
  }

  it("pins the cap constant so this file cannot drift from the implementation", () => {
    expect(hookModule.MAX_INITIAL_FETCH_PAGES).toBe(CAP);
  });

  it("a COMPLETE read that ends exactly on the cap page is NOT truncated", async () => {
    const issued: number[] = [];
    const result = await hookModule.paginateStatusPages(
      readerOver(CAP * PB_PAGE_SIZE, issued),
    );

    // The whole collection came back...
    expect(result.rows).toHaveLength(CAP * PB_PAGE_SIZE);
    // ...so there is nothing left unread. Pre-fix this was `true` — inferred
    // from "cap exhausted while the last page was full", with no evidence.
    expect(result.truncated).toBe(false);
    // And the evidence is exactly one lookahead past the cap, then a stop.
    expect([...issued].sort((a, b) => a - b)).toEqual(PAGES_THROUGH_LOOKAHEAD);
  });

  it("ONE row past the cap IS truncated (the contract fires when it must)", async () => {
    const issued: number[] = [];
    const result = await hookModule.paginateStatusPages(
      readerOver(CAP * PB_PAGE_SIZE + 1, issued),
    );

    expect(result.truncated).toBe(true);
    // The cap still bounds what we RETAIN: the extra row is not smuggled in by
    // the lookahead, whose rows are discarded.
    expect(result.rows).toHaveLength(CAP * PB_PAGE_SIZE);
    expect([...issued].sort((a, b) => a - b)).toEqual(PAGES_THROUGH_LOOKAHEAD);
  });

  it("a read that ends on a SHORT page never issues the lookahead", async () => {
    const issued: number[] = [];
    const result = await hookModule.paginateStatusPages(
      readerOver((CAP - 1) * PB_PAGE_SIZE + 1, issued),
    );

    expect(result.truncated).toBe(false);
    expect(result.rows).toHaveLength((CAP - 1) * PB_PAGE_SIZE + 1);
    // Page 20 was short, so the loop terminated on evidence it already had.
    expect(issued).not.toContain(CAP + 1);
  });

  it("a single short page 1 is one request and no fan-out", async () => {
    const issued: number[] = [];
    const result = await hookModule.paginateStatusPages(readerOver(3, issued));

    expect(result.truncated).toBe(false);
    expect(result.rows).toHaveLength(3);
    expect(issued).toEqual([1]);
  });

  it("a FAILED lookahead fails SAFE: completeness unproven ⇒ truncated", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const rows = rowsFixture(CAP * PB_PAGE_SIZE);
      const result = await hookModule.paginateStatusPages(async (pageNo) => {
        if (pageNo === CAP + 1) throw new Error("lookahead-unreachable");
        return page(rows, pageNo);
      });

      // We cannot prove the read was complete, so we must not claim it was —
      // the bulk caller's fail-loud posture is the safe direction here.
      expect(result.truncated).toBe(true);
      expect(result.rows).toHaveLength(CAP * PB_PAGE_SIZE);
      // ...and the reason is reported, not swallowed.
      expect(
        warn.mock.calls.some((call) =>
          String(call[0]).includes("page-cap lookahead failed"),
        ),
      ).toBe(true);
    } finally {
      warn.mockRestore();
    }
  });
});

// ---------------------------------------------------------------------------
// 2. The same boundary through the HOOK — the observable outage
// ---------------------------------------------------------------------------

describe("useLiveStatus bulk fetch — the cap boundary is not an outage", () => {
  it("renders a COMPLETE 10,000-row snapshot instead of going permanently offline", async () => {
    mockState.bulkRows = rowsFixture(CAP * PB_PAGE_SIZE);
    mockState.supplementalRows = [];

    const { result, unmount } = renderHook(() => useLiveStatus());
    try {
      // PRE-FIX THIS IS `"error"`. The complete read was reported as truncated,
      // `fetchInitial` threw, connect() burned MAX_RECONNECT_ATTEMPTS and the
      // hook landed on `setRows([])` + `status: "error"` — a blank dashboard
      // behind an offline banner, reproducing on every retry and every reload.
      await waitFor(() => expect(result.current.status).toBe("live"), {
        timeout: 30_000,
      });
      expect(result.current.error).toBeNull();
      expect(result.current.rows).toHaveLength(CAP * PB_PAGE_SIZE);

      // Rendering, not merely present: the red cell still paints RED from a
      // signal-less bulk row (fail-safe polarity), which is the verdict the
      // whole PR exists to protect.
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

      // The bound still holds: pages 1..20 retained plus the single lookahead.
      expect([...mockState.bulkPages].sort((a, b) => a - b)).toEqual(
        PAGES_THROUGH_LOOKAHEAD,
      );
    } finally {
      unmount();
    }
  }, 60_000);

  it("still fails LOUD when the read is genuinely truncated", async () => {
    // One row past the cap: rows we never read are whole cells, which would
    // render as no-data gray. That must surface as an error, not a partial
    // matrix — fixing the false positive must not weaken this direction.
    mockState.bulkRows = rowsFixture(CAP * PB_PAGE_SIZE + 1);
    mockState.supplementalRows = [];

    const { result, unmount } = renderHook(() => useLiveStatus());
    try {
      await waitFor(() => expect(result.current.status).toBe("error"), {
        timeout: 40_000,
      });
      expect(result.current.rows).toEqual([]);
      expect(result.current.error).toContain("exceeded");
    } finally {
      unmount();
    }
  }, 60_000);
});

describe("useLiveStatus supplemental fetch — the cap boundary is not a warning", () => {
  it("does not warn 'truncated' when the supplemental read ends exactly on the cap page", async () => {
    // Bulk is small; the SUPPLEMENTAL read is the one that lands on the
    // boundary. Its on-cap behavior is asymmetric (degrade, never throw), so the
    // false positive is only a spurious operational warning here — but it is the
    // same defect, and the same fix has to clear it.
    mockState.bulkRows = rowsFixture(3);
    mockState.supplementalRows = rowsFixture(CAP * PB_PAGE_SIZE);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const { result, unmount } = renderHook(() => useLiveStatus());
    try {
      await waitFor(() => expect(result.current.status).toBe("live"), {
        timeout: 30_000,
      });
      expect(
        warn.mock.calls.some((call) =>
          String(call[0]).includes("supplemental signal fetch truncated"),
        ),
      ).toBe(false);
      expect([...mockState.supplementalPages].sort((a, b) => a - b)).toEqual(
        PAGES_THROUGH_LOOKAHEAD,
      );
    } finally {
      unmount();
      warn.mockRestore();
    }
  }, 60_000);
});
