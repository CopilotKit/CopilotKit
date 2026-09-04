import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { RendererProps } from "@copilotkit/a2ui-renderer";
import type {
  DashboardId,
  Department,
  LedgerSnapshot,
  MetricDef,
  MetricId,
  MetricPoint,
} from "@/skins/exec/data/types";
import { BlockDataProvider } from "../block-data";
import type { BlockData } from "../block-data";
import { renderers } from "./renderers";

// Typed fixture builders keep the test honest against the real domain shapes
// (no `as never`): the renderer derives variance/direction from metric defs
// and points via ../data/derive, so the fixture must genuinely exercise that
// derivation rather than assert against opaque props.
function makeMetricDef(overrides: Partial<MetricDef>): MetricDef {
  return {
    id: "revenue",
    label: "Revenue",
    unit: "usd",
    audience: "both",
    thresholdPct: 0.05,
    byDepartment: false,
    ...overrides,
  };
}

function makeMetricPoint(overrides: Partial<MetricPoint>): MetricPoint {
  return {
    metricId: "revenue",
    period: "2026-01",
    department: "all",
    plan: 100,
    actual: 100,
    forecast: 100,
    ...overrides,
  };
}

function makeSnapshot(overrides: Partial<LedgerSnapshot>): LedgerSnapshot {
  return {
    metricDefs: [],
    points: [],
    initiatives: [],
    narratives: [],
    dashboards: {
      ceo: { id: "ceo", title: "CEO Dashboard", blocks: [] },
      cfo: { id: "cfo", title: "CFO Dashboard", blocks: [] },
    },
    packs: [],
    exceptions: [],
    ...overrides,
  };
}

function makeBlockData(overrides: Partial<BlockData>): BlockData {
  return {
    snapshot: makeSnapshot({}),
    addBlock: async () => {},
    isPinned: () => false,
    ...overrides,
  };
}

// The catalog renderers are typed as A2UI RendererProps components; call them
// directly as functions at the test boundary with the props they consume.
const MetricTile = renderers.MetricTile as (
  props: RendererProps<{
    metricId: MetricId;
    department?: Department;
    compare?: "plan" | "forecast";
  }>,
) => React.ReactElement;

function renderMetricTile(
  data: BlockData,
  props: {
    metricId: MetricId;
    department?: Department;
    compare?: "plan" | "forecast";
  },
) {
  return render(
    <BlockDataProvider value={data}>
      <MetricTile
        props={props}
        // `children` here is the RendererProps render-callback (a function),
        // not React children — passing it as a prop is intentional.
        // eslint-disable-next-line react/no-children-prop
        children={() => null as unknown as React.ReactNode}
      />
    </BlockDataProvider>,
  );
}

describe("exec catalog MetricTile renderer", () => {
  it("shows the derived variance with sign and direction when actual is above plan", () => {
    // Two periods for revenue at department "all": the EARLIER period is a
    // miss (below plan, -20%) and the LATEST period is a beat (above plan,
    // +20%). This catches a renderer that reads the wrong period, not just
    // one that gets the sign backwards.
    // latest: (120 - 100) / 100 = +0.20 -> +20% above plan.
    const data = makeBlockData({
      snapshot: makeSnapshot({
        metricDefs: [makeMetricDef({ id: "revenue" })],
        points: [
          makeMetricPoint({
            metricId: "revenue",
            period: "2026-01",
            plan: 100,
            actual: 80,
            forecast: 90,
          }),
          makeMetricPoint({
            metricId: "revenue",
            period: "2026-02",
            plan: 100,
            actual: 120,
            forecast: 110,
          }),
        ],
      }),
    });

    const { container } = renderMetricTile(data, {
      metricId: "revenue",
      compare: "plan",
    });
    const text = container.textContent ?? "";

    // design-skill.ts mandates every metric leads with its delta and
    // direction as a ▲/▼ glyph before the absolute figure — assert both the
    // numeric SIGN and the direction glyph are present, and that they
    // reflect the LATEST period's beat, not the earlier miss.
    expect(text).toMatch(/▲/);
    expect(text).toMatch(/\+20(\.0+)?%/);
    expect(text).not.toMatch(/▼/);
  });

  /**
   * THE EXPLICIT FAILURE SURFACE. A block whose query resolves to nothing has
   * to SAY so: a silently empty tile is indistinguishable from one that has
   * not loaded, and on a board pack that reads as "no variance" rather than
   * "no data". `data-testid="block-error"` plus `role="alert"` is the contract
   * (`MissingTile` in `./renderers.tsx`), so this asserts the surface rather
   * than the sentence.
   */
  it("reports a missing metric def through the block-error surface", () => {
    const data = makeBlockData({
      snapshot: makeSnapshot({
        // A point exists, but NO def — so there is no label, and no threshold
        // to breach against. Unrenderable, not zero.
        metricDefs: [],
        points: [
          makeMetricPoint({ metricId: "revenue", plan: 100, actual: 120 }),
        ],
      }),
    });

    const { container } = renderMetricTile(data, { metricId: "revenue" });

    const error = container.querySelector('[data-testid="block-error"]');
    expect(
      error,
      "a block that resolved to nothing must render the error surface",
    ).not.toBeNull();
    expect(error?.getAttribute("role")).toBe("alert");
    // It names WHAT is missing, or the operator is left guessing which block failed.
    expect(error?.textContent ?? "").toContain("revenue");
    // And it renders no figure at all — a tile drawn from a missing def would
    // print the point's raw number under no label.
    expect(container.textContent ?? "").not.toMatch(/\$|%/);
  });

  /**
   * THE NON-FINITE GUARD. Variance is `(actual - plan) / plan`, so a zero
   * plan (or zero forecast) yields ±Infinity, and zero-over-zero yields NaN.
   * `Delta` reports either as unavailable — printing "Infinity%" or "NaN%" on
   * a board pack is worse than printing nothing, because it looks like a
   * figure.
   */
  it.each([
    { name: "a zero plan (Infinity)", plan: 0, actual: 5 },
    { name: "a zero plan and zero actual (NaN)", plan: 0, actual: 0 },
  ])("reports variance against $name as unavailable", ({ plan, actual }) => {
    const data = makeBlockData({
      snapshot: makeSnapshot({
        metricDefs: [makeMetricDef({ id: "revenue" })],
        points: [makeMetricPoint({ metricId: "revenue", plan, actual })],
      }),
    });

    const { container } = renderMetricTile(data, {
      metricId: "revenue",
      compare: "plan",
    });
    const text = container.textContent ?? "";

    expect(text).toContain("n/a");
    expect(text).not.toMatch(/Infinity|NaN/);
    // No percentage AT ALL: the delta is the one percentage on the tile.
    expect(text).not.toMatch(/%/);
    // No direction glyph either — a ▲/▼ over "n/a" claims a direction the
    // arithmetic could not produce.
    expect(text).not.toMatch(/[▲▼]/);
  });

  it("reports a non-finite variance against forecast as unavailable too", () => {
    const data = makeBlockData({
      snapshot: makeSnapshot({
        metricDefs: [makeMetricDef({ id: "revenue" })],
        points: [
          makeMetricPoint({
            metricId: "revenue",
            plan: 100,
            actual: 120,
            forecast: 0,
          }),
        ],
      }),
    });

    const { container } = renderMetricTile(data, {
      metricId: "revenue",
      compare: "forecast",
    });
    const text = container.textContent ?? "";

    expect(text).toContain("n/a");
    expect(text).not.toMatch(/Infinity|NaN/);
  });
});

const VarianceBar = renderers.VarianceBar as (
  props: RendererProps<{ metricId: MetricId }>,
) => React.ReactElement;

function renderVarianceBar(data: BlockData, metricId: MetricId) {
  return render(
    <BlockDataProvider value={data}>
      <VarianceBar
        props={{ metricId }}
        // `children` is the RendererProps render-callback, not React children.
        // eslint-disable-next-line react/no-children-prop
        children={() => null as unknown as React.ReactNode}
      />
    </BlockDataProvider>,
  );
}

const DEPARTMENTS: Department[] = [
  "manufacturing",
  "distribution",
  "field-services",
  "corporate",
];

/**
 * Two periods for the same four departments, with the LATEST period's numbers
 * deliberately unlike the earlier one's, per department.
 *
 * The earlier period is a uniform 10x blowout ($1K actual, +900.0%); the
 * latest carries four distinct, modest variances. So the rendered figures
 * alone say which period the renderer read — which is the only thing a
 * period-narrowing test can honestly assert here (see the test below).
 */
const STALE_ACTUAL = 1000;
const LATEST_ACTUAL: Record<Department, number> = {
  manufacturing: 105, // +5.0%
  distribution: 120, // +20.0%
  "field-services": 90, // -10.0%
  corporate: 100, // ±0.0%
};

function twoPeriodOpexSnapshot(): LedgerSnapshot {
  return makeSnapshot({
    metricDefs: [
      makeMetricDef({ id: "opex", label: "Opex", byDepartment: true }),
    ],
    points: DEPARTMENTS.flatMap((department) => [
      makeMetricPoint({
        metricId: "opex",
        period: "2026-01",
        department,
        plan: 100,
        actual: STALE_ACTUAL,
        forecast: 100,
      }),
      makeMetricPoint({
        metricId: "opex",
        period: "2026-02",
        department,
        plan: 100,
        actual: LATEST_ACTUAL[department],
        forecast: 100,
      }),
    ]),
  });
}

describe("exec catalog VarianceBar renderer", () => {
  it("renders exactly one bar per department", () => {
    const data = makeBlockData({ snapshot: twoPeriodOpexSnapshot() });

    const { container } = renderVarianceBar(data, "opex");

    // Contract: each per-department row is tagged
    // `data-testid="variance-bar-row"` (this app already uses data-testid
    // contracts for DOM-shape tests, e.g. inline-block-surface), so the
    // count is independent of department label text/formatting choices the
    // eventual implementation makes.
    const rows = container.querySelectorAll('[data-testid="variance-bar-row"]');
    expect(rows.length).toBe(4);
  });

  /**
   * PERIOD NARROWING, ASSERTED ON THE VALUES — the only place it shows.
   *
   * A row COUNT cannot test this: the renderer walks the fixed `DEPARTMENTS`
   * list and takes at most one point each, so it emits at most four rows
   * whatever the snapshot holds and whether or not it narrows by period at
   * all. Dropping the `latestClosedPeriod` narrowing left the count at 4 and
   * kept the old test green — while the bars silently reported a
   * fourteen-month-old month's figures.
   *
   * So: two periods with distinguishable numbers, and every assertion is
   * about which period's FIGURES reached the screen.
   */
  it("renders the LATEST period's figures, not an earlier period's", () => {
    const data = makeBlockData({ snapshot: twoPeriodOpexSnapshot() });

    const { container } = renderVarianceBar(data, "opex");
    const text = container.textContent ?? "";

    // The label names the period the figures came from.
    expect(text).toContain("Feb 2026");
    expect(text).not.toContain("Jan 2026");

    // Each department's own latest variance and absolute figure.
    expect(text).toContain("+5.0%");
    expect(text).toContain("+20.0%");
    expect(text).toContain("-10.0%");
    expect(text).toContain("$105");
    expect(text).toContain("$120");
    expect(text).toContain("$90");

    // And NOTHING from the stale period: $1K / +900.0% appear only there.
    expect(text).not.toContain("900.0%");
    expect(text).not.toContain("$1K");
  });
});

const ExceptionList = renderers.ExceptionList as (
  props: RendererProps<{ audience?: "ceo" | "cfo" | "both" }>,
) => React.ReactElement;

function renderExceptionList(
  data: BlockData,
  props: { audience?: "ceo" | "cfo" | "both" },
) {
  return render(
    <BlockDataProvider value={data}>
      <ExceptionList
        props={props}
        // `children` is the RendererProps render-callback, not React children.
        // eslint-disable-next-line react/no-children-prop
        children={() => null as unknown as React.ReactNode}
      />
    </BlockDataProvider>,
  );
}

/**
 * One CEO-only metric, one CFO-only metric, one flagged for BOTH — plus two
 * rows that must never appear on any reader's list: an exception from an
 * earlier period, and one whose metric has no def.
 */
function audienceSnapshot(): LedgerSnapshot {
  return makeSnapshot({
    metricDefs: [
      makeMetricDef({ id: "revenue", label: "Revenue", audience: "ceo" }),
      makeMetricDef({ id: "dsoDays", label: "DSO days", audience: "cfo" }),
      makeMetricDef({ id: "cash", label: "Cash", audience: "both" }),
    ],
    // The latest closed period is read off the POINTS, so they set the window.
    points: [
      makeMetricPoint({ metricId: "revenue", period: "2026-01" }),
      makeMetricPoint({ metricId: "revenue", period: "2026-02" }),
    ],
    exceptions: [
      {
        metricId: "revenue",
        period: "2026-02",
        department: "all",
        variancePct: 0.111,
        explained: false,
      },
      {
        metricId: "dsoDays",
        period: "2026-02",
        department: "all",
        variancePct: 0.222,
        explained: false,
      },
      {
        metricId: "cash",
        period: "2026-02",
        department: "all",
        variancePct: 0.333,
        explained: true,
      },
      // Earlier period — outside the window, whatever the audience.
      {
        metricId: "revenue",
        period: "2026-01",
        department: "all",
        variancePct: 0.444,
        explained: false,
      },
      // No def on the ledger: no label, no threshold it breached. Dropped.
      {
        metricId: "nps",
        period: "2026-02",
        department: "all",
        variancePct: 0.555,
        explained: false,
      },
    ],
  });
}

describe("exec catalog ExceptionList renderer", () => {
  it("shows the CFO's metrics plus the shared ones, and none of the CEO-only ones", () => {
    const { container } = renderExceptionList(
      makeBlockData({ snapshot: audienceSnapshot() }),
      { audience: "cfo" },
    );
    const text = container.textContent ?? "";

    expect(text).toContain("DSO days");
    // A metric flagged for "both" belongs on EITHER reader's list.
    expect(text).toContain("Cash");
    expect(text).not.toContain("Revenue");
    expect(text).not.toMatch(/11\.1%/);
  });

  it("shows the CEO's metrics plus the shared ones, and none of the CFO-only ones", () => {
    const { container } = renderExceptionList(
      makeBlockData({ snapshot: audienceSnapshot() }),
      { audience: "ceo" },
    );
    const text = container.textContent ?? "";

    expect(text).toContain("Revenue");
    expect(text).toContain("Cash");
    expect(text).not.toContain("DSO days");
    expect(text).not.toMatch(/22\.2%/);
  });

  it("shows every audience's metrics when the audience is unset", () => {
    const { container } = renderExceptionList(
      makeBlockData({ snapshot: audienceSnapshot() }),
      {},
    );
    const text = container.textContent ?? "";

    expect(text).toContain("Revenue");
    expect(text).toContain("DSO days");
    expect(text).toContain("Cash");
    // The window and the def requirement hold even with no audience filter:
    // the earlier period's row (+44.4%) and the def-less row (+55.5%) stay out.
    expect(text).toContain("Feb 2026");
    expect(text).not.toMatch(/44\.4%/);
    expect(text).not.toMatch(/55\.5%/);
  });

  it("says so rather than rendering an empty list when no exception matches", () => {
    const snapshot = audienceSnapshot();
    const { container } = renderExceptionList(
      makeBlockData({ snapshot: { ...snapshot, exceptions: [] } }),
      { audience: "cfo" },
    );
    expect(container.textContent ?? "").toMatch(/No variances awaiting/i);
  });

  it("reports an empty ledger through the block-error surface", () => {
    const { container } = renderExceptionList(
      makeBlockData({ snapshot: makeSnapshot({}) }),
      { audience: "cfo" },
    );
    const error = container.querySelector('[data-testid="block-error"]');
    expect(error).not.toBeNull();
    expect(error?.getAttribute("role")).toBe("alert");
  });
});

const AddToDashboard = renderers.AddToDashboard as (
  props: RendererProps<{ blockId: string }>,
) => React.ReactElement;

function renderAddToDashboard(data: BlockData, blockId: string) {
  return render(
    <BlockDataProvider value={data}>
      <AddToDashboard
        props={{ blockId }}
        // `children` is the RendererProps render-callback, not React children.
        // eslint-disable-next-line react/no-children-prop
        children={() => null as unknown as React.ReactNode}
      />
    </BlockDataProvider>,
  );
}

/**
 * A `BlockData` whose `isPinned` is derived from the same `pinned` set
 * `addBlock` writes to — the faithful stand-in for the real bridge
 * (`../providers.tsx`), where `addBlock` awaits the ledger `refresh()` before
 * it resolves and `isPinned` reads the refreshed snapshot.
 *
 * A fake with a frozen `isPinned: () => false` and a no-op `addBlock` cannot
 * occur in the app, and testing against it is what let the renderer keep a
 * local sticky "pinned" flag that survived an unpin.
 */
function pinnableBlockData(overrides: Partial<BlockData> = {}) {
  const pinned = new Set<string>();
  const addBlock = vi.fn(async (_dashboardId: DashboardId, blockId: string) => {
    pinned.add(blockId);
  });
  return {
    pinned,
    addBlock,
    data: makeBlockData({
      addBlock,
      isPinned: (blockId: string) => pinned.has(blockId),
      ...overrides,
    }),
  };
}

describe("exec catalog AddToDashboard renderer", () => {
  it("renders one pin button per dashboard, pins on click, and flips to Pinned state", async () => {
    const { addBlock, data } = pinnableBlockData();

    renderAddToDashboard(data, "block-1");

    const ceoButton = screen.getByText("Pin to CEO dashboard");
    expect(screen.getByText("Pin to CFO dashboard")).toBeDefined();

    fireEvent.click(ceoButton);

    expect(addBlock).toHaveBeenCalledWith("ceo", "block-1");
    expect(await screen.findByText("Pinned ✓")).toBeDefined();
  });

  /**
   * THE UNPIN ROUND TRIP. The transcript keeps this control mounted after the
   * operator unpins the block from the dashboard page, and `store.removeBlock`
   * puts the block back in `drafts` so a re-pin genuinely succeeds. So the
   * control has to offer the buttons again — a sticky local "pinned" flag left
   * it reading "Pinned ✓" over a block that was no longer on any dashboard,
   * with no way back.
   */
  it("returns to the pin buttons once the block is unpinned elsewhere", async () => {
    const { pinned, data } = pinnableBlockData();
    const { rerender } = render(
      <BlockDataProvider value={data}>
        <AddToDashboard
          props={{ blockId: "block-1" }}
          // eslint-disable-next-line react/no-children-prop
          children={() => null as unknown as React.ReactNode}
        />
      </BlockDataProvider>,
    );

    fireEvent.click(screen.getByText("Pin to CEO dashboard"));
    expect(await screen.findByText("Pinned ✓")).toBeDefined();

    // The dashboard grid's remove button unpins it out of band; the next
    // ledger snapshot no longer holds it.
    pinned.delete("block-1");
    rerender(
      <BlockDataProvider
        value={{ ...data, isPinned: (id: string) => pinned.has(id) }}
      >
        <AddToDashboard
          props={{ blockId: "block-1" }}
          // eslint-disable-next-line react/no-children-prop
          children={() => null as unknown as React.ReactNode}
        />
      </BlockDataProvider>,
    );

    expect(screen.getByText("Pin to CEO dashboard")).toBeDefined();
    expect(screen.getByText("Pin to CFO dashboard")).toBeDefined();
    expect(screen.queryByText("Pinned ✓")).toBeNull();
  });

  it("shows the server's message loudly when a pin is refused", async () => {
    const { data } = pinnableBlockData({
      addBlock: vi
        .fn()
        .mockRejectedValue(
          new Error(
            'add block failed: ALREADY_PINNED: block "block-1" is already pinned to the "ceo" dashboard — unpin it there first',
          ),
        ),
    });

    renderAddToDashboard(data, "block-1");
    fireEvent.click(screen.getByText("Pin to CFO dashboard"));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("ALREADY_PINNED");
    // Still offering the buttons: a refused pin must not read as a pin.
    expect(screen.queryByText("Pinned ✓")).toBeNull();
  });
});
