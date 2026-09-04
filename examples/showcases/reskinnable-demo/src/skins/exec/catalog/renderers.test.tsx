import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { RendererProps } from "@copilotkit/a2ui-renderer";
import type {
  DashboardId,
  Department,
  Initiative,
  LedgerSnapshot,
  MetricDef,
  MetricId,
  MetricPoint,
} from "@/skins/exec/data/types";
import * as store from "../data/store";
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

/**
 * The one `<span>` whose whole text is `text` — the `Delta` glyph. Colour is
 * carried on that span's own class list, so a test that reads `container`
 * className soup cannot tell a green delta from a red one beside it.
 */
function deltaWithText(container: HTMLElement, text: string) {
  return Array.from(container.querySelectorAll("span")).find(
    (el) => el.textContent === text,
  );
}

const Stack = renderers.Stack as (
  props: RendererProps<{
    children: string[];
    gap?: "sm" | "md" | "lg" | "xl";
  }>,
) => React.ReactElement;

/**
 * `Stack` is the layout primitive every generated block is wrapped in
 * (`../blocks/build-block-ops.ts` emits `Stack` + `Heading` + one kind
 * component), so a Stack that drops or reorders a child id silently drops a
 * whole block's contents.
 */
describe("exec catalog Stack renderer", () => {
  it("renders one slot per child id, in the order given", () => {
    const { container } = render(
      <Stack
        props={{ children: ["block-a", "block-b"], gap: "lg" }}
        // `children` is the RendererProps render-callback, not React children.
        // eslint-disable-next-line react/no-children-prop
        children={(id: string) => <p data-testid="slot">{id}</p>}
      />,
    );

    expect(
      Array.from(container.querySelectorAll('[data-testid="slot"]')).map(
        (el) => el.textContent,
      ),
    ).toEqual(["block-a", "block-b"]);
    expect(container.firstElementChild?.className ?? "").toContain("gap-6");
  });

  it("renders an empty container — not a child — when there are no child ids", () => {
    const { container } = render(
      <Stack
        props={{ children: [] }}
        // eslint-disable-next-line react/no-children-prop
        children={() => <p>never rendered</p>}
      />,
    );

    expect(container.textContent).toBe("");
    // The default gap still applies, so an empty stack keeps the block's shape.
    expect(container.firstElementChild?.className ?? "").toContain("gap-4");
  });
});

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
   * COLOUR BY BREACH, NOT BY SIGN — the same rule `ExceptionList` and the CEO
   * dashboard's fixed strip (`../pages/ceo-dashboard.tsx`) already follow.
   *
   * This tile prints its own "Breach" chip, so a green delta beside that chip
   * is the block contradicting itself in one line: the seeded CFO dashboard
   * showed burn rate at +10% in text-positive green next to a Breach badge.
   * A breach is bad news whichever direction it went — the sign glyph still
   * says which way, but the colour has to say "this breached".
   */
  it("colours a seeded breaching metric's delta by breach, not by sign", () => {
    store.reset();
    const { container } = renderMetricTile(
      makeBlockData({ snapshot: store.snapshot() }),
      { metricId: "burnRate" },
    );

    // The seed forces burn rate to +10% against a 6% threshold at the latest
    // closed period (`../data/seed.ts`) — over plan, and a breach.
    expect(container.textContent ?? "").toContain("Breach");
    const delta = deltaWithText(container, "▲ +10.0%");
    expect(
      delta,
      "the seeded +10% burn-rate overrun should be on the tile",
    ).toBeDefined();
    expect(delta?.className ?? "").toContain("text-negative");
    expect(delta?.className ?? "").not.toContain("text-positive");
  });

  it("keeps the sign reading on a metric that varies WITHOUT breaching", () => {
    const data = makeBlockData({
      snapshot: makeSnapshot({
        metricDefs: [makeMetricDef({ id: "revenue", thresholdPct: 0.05 })],
        points: [
          makeMetricPoint({ metricId: "revenue", plan: 100, actual: 103 }),
        ],
      }),
    });

    const { container } = renderMetricTile(data, { metricId: "revenue" });

    // +3% against a 5% threshold: genuinely good news, and no chip on the tile.
    expect(container.textContent ?? "").not.toContain("Breach");
    const delta = deltaWithText(container, "▲ +3.0%");
    expect(delta?.className ?? "").toContain("text-positive");
    expect(delta?.className ?? "").not.toContain("text-negative");
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

/**
 * THE UNRESOLVED DATA REF. `Heading`/`Text` take `string | { path }` because
 * the catalog declares a data-bound ref as a legal value; the A2UI runtime is
 * supposed to resolve the ref BEFORE render. When it doesn't — a path that
 * names nothing in the data model — the component still gets the `{ path }`
 * object. Painting that as an empty string puts a blank heading on a board
 * pack, which reads as "this section is intentionally untitled" rather than
 * "the binding broke"; this file's own rule (`MissingTile`) is that a block
 * whose query resolved to nothing must SAY so.
 */
const LabelOnly = {
  Heading: renderers.Heading as (
    props: RendererProps<{ text: string | { path: string } }>,
  ) => React.ReactElement,
  Text: renderers.Text as (
    props: RendererProps<{
      text: string | { path: string };
      tone?: "default" | "muted";
    }>,
  ) => React.ReactElement,
};

describe.each(["Heading", "Text"] as const)(
  "exec catalog %s renderer",
  (name) => {
    const Component = LabelOnly[name];

    it("renders the resolved label text", () => {
      const { container } = render(
        <Component
          props={{ text: "Board pack" }}
          // eslint-disable-next-line react/no-children-prop
          children={() => null as unknown as React.ReactNode}
        />,
      );
      expect(container.textContent).toContain("Board pack");
      expect(container.querySelector('[data-testid="block-error"]')).toBeNull();
    });

    it("reports an UNRESOLVED data ref through the block-error surface", () => {
      const { container } = render(
        <Component
          props={{ text: { path: "/metrics/revenue/label" } }}
          // eslint-disable-next-line react/no-children-prop
          children={() => null as unknown as React.ReactNode}
        />,
      );

      const error = container.querySelector('[data-testid="block-error"]');
      expect(
        error,
        "an unresolved ref must not render as an empty label",
      ).not.toBeNull();
      expect(error?.getAttribute("role")).toBe("alert");
      // It names the path, or nobody can tell WHICH binding broke.
      expect(error?.textContent ?? "").toContain("/metrics/revenue/label");
    });
  },
);

const TrendLine = renderers.TrendLine as (
  props: RendererProps<{
    metricId: MetricId;
    department?: Department | "all";
    months?: number;
  }>,
) => React.ReactElement;

function renderTrendLine(
  data: BlockData,
  props: {
    metricId: MetricId;
    department?: Department | "all";
    months?: number;
  },
) {
  return render(
    <BlockDataProvider value={data}>
      <TrendLine
        props={props}
        // `children` is the RendererProps render-callback, not React children.
        // eslint-disable-next-line react/no-children-prop
        children={() => null as unknown as React.ReactNode}
      />
    </BlockDataProvider>,
  );
}

/** The i-th consecutive "YYYY-MM" from 2026-01, rolling the year over. */
function periodAt(i: number): string {
  const year = 2026 + Math.floor(i / 12);
  const month = (i % 12) + 1;
  return `${year}-${String(month).padStart(2, "0")}`;
}

/** `count` consecutive monthly points from 2026-01, actual = plan + `i`×10%. */
function monthlySnapshot(count: number): LedgerSnapshot {
  return makeSnapshot({
    metricDefs: [makeMetricDef({ id: "burnRate", label: "Burn Rate" })],
    points: Array.from({ length: count }, (_, i) =>
      makeMetricPoint({
        metricId: "burnRate",
        period: periodAt(i),
        plan: 100,
        // +0%, +10%, +20%, … so every period's figures are distinguishable.
        actual: 100 + i * 10,
        forecast: 100,
      }),
    ),
  });
}

describe("exec catalog TrendLine renderer", () => {
  /**
   * `months` is a QUERY parameter — how much history to fetch. A renderer that
   * ignores it charts the whole 24-month series while the label claims the
   * window the agent asked for, so the assertions are about which periods'
   * figures reached the screen, not about the prop being echoed.
   */
  it("narrows the series to the trailing `months` window", () => {
    const data = makeBlockData({ snapshot: monthlySnapshot(6) });

    const { container } = renderTrendLine(data, {
      metricId: "burnRate",
      months: 3,
    });
    const text = container.textContent ?? "";

    // The window's OWN endpoints, and the label counting what it charted.
    expect(text).toContain("3mo");
    expect(text).toContain("Apr 2026");
    expect(text).toContain("Jun 2026");
    // Everything before the window stays off the chart's axis labels.
    expect(text).not.toContain("Jan 2026");
    expect(text).not.toContain("Mar 2026");
  });

  it("defaults to a 12-month window when the agent omits `months`", () => {
    const data = makeBlockData({ snapshot: monthlySnapshot(18) });

    const { container } = renderTrendLine(data, { metricId: "burnRate" });
    const text = container.textContent ?? "";

    expect(text).toContain("12mo");
    // 18 periods ending at 2027-06; the 12-month window opens at 2026-07.
    expect(text).toContain("Jul 2026");
    expect(text).not.toContain("Jun 2026");
  });

  /**
   * THE LATEST-PERIOD READ. The footer reports one variance and one absolute
   * figure: they must be the WINDOW'S LAST period, not its first and not the
   * first matching row. A renderer that reads `trend[0]` still draws a
   * plausible chart while reporting a fourteen-month-old number as today's.
   */
  it("reports the window's LATEST period in the footer, not its first", () => {
    const data = makeBlockData({ snapshot: monthlySnapshot(4) });

    const { container } = renderTrendLine(data, { metricId: "burnRate" });
    const text = container.textContent ?? "";

    // Latest point: plan 100, actual 130 -> +30.0%.
    expect(text).toMatch(/▲/);
    expect(text).toMatch(/\+30\.0%/);
    expect(text).toContain("$130");
    // The first period's own variance (+0.0%) is not what the footer reports.
    expect(text).not.toMatch(/±0\.0%/);
  });

  /**
   * THE ONE-POINT ARM. Two points are the minimum a line can be drawn from;
   * with one, `linePoints` would emit a single coordinate and the SVG would
   * render an invisible "trend". Say there is not enough history instead.
   */
  it("says there is not enough history rather than charting a single point", () => {
    const data = makeBlockData({ snapshot: monthlySnapshot(1) });

    const { container } = renderTrendLine(data, { metricId: "burnRate" });

    expect(container.textContent ?? "").toMatch(/not enough history/i);
    expect(container.querySelector("polyline")).toBeNull();
  });

  /**
   * COLOUR BY BREACH, NOT BY SIGN — the footer's single delta is the same
   * claim `MetricTile` and `VarianceBar` make, on the same points.
   */
  it("colours the footer delta by breach, not by sign", () => {
    const data = makeBlockData({ snapshot: monthlySnapshot(4) });

    const { container } = renderTrendLine(data, { metricId: "burnRate" });

    // Latest point is +30% against a 5% threshold: a breach, not a beat.
    const delta = deltaWithText(container, "▲ +30.0%");
    expect(
      delta,
      "the footer should report the window's latest variance",
    ).toBeDefined();
    expect(delta?.className ?? "").toContain("text-negative");
    expect(delta?.className ?? "").not.toContain("text-positive");
  });

  it("keeps the sign reading when the latest period is within threshold", () => {
    const data = makeBlockData({
      snapshot: makeSnapshot({
        metricDefs: [
          makeMetricDef({
            id: "burnRate",
            label: "Burn Rate",
            thresholdPct: 0.05,
          }),
        ],
        points: [
          makeMetricPoint({
            metricId: "burnRate",
            period: "2026-01",
            plan: 100,
            actual: 100,
          }),
          makeMetricPoint({
            metricId: "burnRate",
            period: "2026-02",
            plan: 100,
            actual: 102,
          }),
        ],
      }),
    });

    const { container } = renderTrendLine(data, { metricId: "burnRate" });

    const delta = deltaWithText(container, "▲ +2.0%");
    expect(delta?.className ?? "").toContain("text-positive");
    expect(delta?.className ?? "").not.toContain("text-negative");
  });

  it("reports a metric with no series through the block-error surface", () => {
    const data = makeBlockData({ snapshot: monthlySnapshot(6) });

    const { container } = renderTrendLine(data, {
      metricId: "burnRate",
      department: "distribution",
    });

    const error = container.querySelector('[data-testid="block-error"]');
    expect(error).not.toBeNull();
    expect(error?.getAttribute("role")).toBe("alert");
    expect(error?.textContent ?? "").toContain("burnRate");
  });
});

const InitiativeTable = renderers.InitiativeTable as (
  props: RendererProps<Record<string, never>>,
) => React.ReactElement;

function renderInitiativeTable(data: BlockData) {
  return render(
    <BlockDataProvider value={data}>
      <InitiativeTable
        props={{}}
        // `children` is the RendererProps render-callback, not React children.
        // eslint-disable-next-line react/no-children-prop
        children={() => null as unknown as React.ReactNode}
      />
    </BlockDataProvider>,
  );
}

const INITIATIVES: Initiative[] = [
  {
    id: "init-a",
    name: "Distribution center automation",
    owner: "Priya Nair",
    status: "red",
    note: "Integrator delay pushed go-live past quarter close.",
  },
  {
    id: "init-b",
    name: "ERP migration, phase 2",
    owner: "Dana Kim",
    status: "green",
    note: "On track for next month's cutover window.",
  },
];

describe("exec catalog InitiativeTable renderer", () => {
  it("renders one row per initiative, with owner, status and note", () => {
    const data = makeBlockData({
      snapshot: makeSnapshot({ initiatives: INITIATIVES }),
    });

    const { container } = renderInitiativeTable(data);
    const text = container.textContent ?? "";

    expect(container.querySelectorAll("tbody tr").length).toBe(2);
    for (const initiative of INITIATIVES) {
      expect(text).toContain(initiative.name);
      expect(text).toContain(initiative.owner);
      expect(text).toContain(initiative.status);
      expect(text).toContain(initiative.note);
    }
  });

  it("reports an empty initiative list through the block-error surface", () => {
    const { container } = renderInitiativeTable(
      makeBlockData({ snapshot: makeSnapshot({ initiatives: [] }) }),
    );

    const error = container.querySelector('[data-testid="block-error"]');
    expect(error).not.toBeNull();
    expect(error?.getAttribute("role")).toBe("alert");
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

/** One latest-period opex row per department, with the plan/actual given. */
function opexSnapshotWith(
  perDepartment: Record<Department, { plan: number; actual: number }>,
): LedgerSnapshot {
  return makeSnapshot({
    metricDefs: [
      makeMetricDef({ id: "opex", label: "Opex", byDepartment: true }),
    ],
    points: DEPARTMENTS.map((department) =>
      makeMetricPoint({
        metricId: "opex",
        period: "2026-02",
        department,
        plan: perDepartment[department].plan,
        actual: perDepartment[department].actual,
        forecast: perDepartment[department].plan,
      }),
    ),
  });
}

/** The row whose label names `department`, and its plan marker (if any). */
function rowFor(container: HTMLElement, department: string) {
  return Array.from(
    container.querySelectorAll('[data-testid="variance-bar-row"]'),
  ).find((row) => row.textContent?.includes(department));
}

function planMarkerIn(container: HTMLElement, department: string) {
  return rowFor(container, department)?.querySelector<HTMLElement>(
    '[data-testid="variance-plan-marker"]',
  );
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

  /**
   * A DEPARTMENT WITH NO ROW AT THE LATEST PERIOD IS NEWS, NOT AN ABSENCE.
   *
   * Dropping it silently produces a three-bar chart of a four-department
   * company: the reader has no way to tell "corporate did not report this
   * month" from "corporate is not a department". Worse, the bars are drawn
   * against a max taken over the rows that survived, so the whole chart's
   * scale silently shifts when a department goes missing — every remaining
   * bar changes length for a reason nothing on screen explains.
   */
  it("renders a department missing from the latest period as an explicit unavailable row", () => {
    const snapshot = twoPeriodOpexSnapshot();
    const data = makeBlockData({
      snapshot: {
        ...snapshot,
        // Corporate reported in January and then stopped.
        points: snapshot.points.filter(
          (p) => !(p.department === "corporate" && p.period === "2026-02"),
        ),
      },
    });

    const { container } = renderVarianceBar(data, "opex");
    const text = container.textContent ?? "";

    // Still four rows — one per department, in the fixed order.
    const rows = container.querySelectorAll('[data-testid="variance-bar-row"]');
    expect(rows.length).toBe(4);

    const corporate = Array.from(rows).find((row) =>
      row.textContent?.includes("Corporate"),
    );
    expect(corporate, "the missing department still gets a row").toBeDefined();
    expect(corporate?.textContent ?? "").toMatch(/no data|not reported/i);
    // And it reports NOTHING quantitative: no bar, no figure, no variance.
    expect(corporate?.textContent ?? "").not.toMatch(/%|\$/);
    // Least of all January's stale $1K / +900.0%.
    expect(text).not.toContain("900.0%");
    expect(text).not.toContain("$1K");
  });

  /**
   * COLOUR BY BREACH, NOT BY SIGN — the third surface of the same defect
   * `ExceptionList` and the CEO strip were already fixed for. A department
   * running 20% over plan on a 5%-threshold cost line is not good news, and
   * painting it green here disagrees with every other surface that shows the
   * same overrun.
   */
  it("colours a breaching department's delta by breach, not by sign", () => {
    const data = makeBlockData({ snapshot: twoPeriodOpexSnapshot() });

    const { container } = renderVarianceBar(data, "opex");

    const breaching = deltaWithText(container, "▲ +20.0%");
    expect(
      breaching,
      "distribution's +20% row should be on the chart",
    ).toBeDefined();
    expect(breaching?.className ?? "").toContain("text-negative");
    expect(breaching?.className ?? "").not.toContain("text-positive");

    // Manufacturing's +5.0% sits exactly ON opex's 5% threshold, so it is not
    // a breach (`isBreach` compares with `>`) and keeps the sign reading —
    // without this the "fix" could be a blanket alert tone on every row.
    const clean = deltaWithText(container, "▲ +5.0%");
    expect(clean?.className ?? "").toContain("text-positive");
    expect(clean?.className ?? "").not.toContain("text-negative");
  });

  it("colours the seeded distribution opex overrun as a breach", () => {
    store.reset();

    const { container } = renderVarianceBar(
      makeBlockData({ snapshot: store.snapshot() }),
      "opex",
    );

    // The seed forces distribution to +9% against opex's 5% threshold.
    const delta = deltaWithText(container, "▲ +9.0%");
    expect(
      delta,
      "the seeded +9% distribution overrun should be on the chart",
    ).toBeDefined();
    expect(delta?.className ?? "").toContain("text-negative");
    expect(delta?.className ?? "").not.toContain("text-positive");
  });

  /**
   * THE PLAN MARKER IS A POSITION, NOT A WIDTH.
   *
   * The bar has a 2% minimum width so a tiny-but-real actual still draws
   * something. Reusing that clamp to place the plan marker puts the rule at a
   * number the ledger never held — and at the top of the scale it places the
   * 1px rule at `left: 100%`, i.e. flush against the outside edge of an
   * `overflow-hidden` track, so the department with the LARGEST plan is
   * exactly the one whose plan marker disappears.
   */
  it("places the plan marker at the plan's true share of the scale, not the bar's minimum width", () => {
    const data = makeBlockData({
      snapshot: opexSnapshotWith({
        // Distribution's plan is the largest figure on the chart, so it sets
        // the shared scale and its own marker sits at the very end of it.
        manufacturing: { plan: 1, actual: 1 },
        distribution: { plan: 200, actual: 50 },
        "field-services": { plan: 100, actual: 100 },
        corporate: { plan: 50, actual: 50 },
      }),
    });

    const { container } = renderVarianceBar(data, "opex");

    // 1 of a 200 scale is 0.5% — NOT the bar's 2% floor.
    expect(planMarkerIn(container, "Manufacturing")?.style.left).toBe("0.5%");
    expect(planMarkerIn(container, "Corporate")?.style.left).toBe("25%");

    // At the end of the track the marker is offset by its own width, so it
    // stays inside the clipped track instead of being cut off entirely.
    const widest = planMarkerIn(container, "Distribution");
    expect(widest?.style.left).toBe("100%");
    expect(widest?.style.transform).toBe("translateX(-100%)");
  });

  it("draws no plan marker for a department that planned nothing", () => {
    const data = makeBlockData({
      snapshot: opexSnapshotWith({
        manufacturing: { plan: 0, actual: 40 },
        distribution: { plan: 100, actual: 90 },
        "field-services": { plan: 100, actual: 100 },
        corporate: { plan: 100, actual: 100 },
      }),
    });

    const { container } = renderVarianceBar(data, "opex");

    expect(
      planMarkerIn(container, "Manufacturing"),
      "a zero plan has no position on the scale — a marker at the bar's minimum width invents one",
    ).toBeFalsy();
    // Every department that DID plan still gets its marker.
    expect(
      container.querySelectorAll('[data-testid="variance-plan-marker"]').length,
    ).toBe(3);
  });

  /**
   * SAY WHICH HALF OF THE LEDGER IS MISSING. "no def on the ledger" and "no
   * department filed this period" are different failures with different
   * fixes, and reporting a missing DEF as "no per-department series" sends the
   * reader looking for rows that are sitting right there in the snapshot.
   */
  it("reports a missing metric def as missing, not as a metric with no per-department series", () => {
    const snapshot = twoPeriodOpexSnapshot();
    const data = makeBlockData({ snapshot: { ...snapshot, metricDefs: [] } });

    const { container } = renderVarianceBar(data, "opex");

    const error = container.querySelector('[data-testid="block-error"]');
    expect(error).not.toBeNull();
    expect(error?.getAttribute("role")).toBe("alert");
    expect(error?.textContent ?? "").toContain("opex");
    expect(error?.textContent ?? "").toMatch(/definition/i);
    expect(error?.textContent ?? "").not.toMatch(/per-department series/i);
  });

  it("reports a metric with no per-department series as exactly that", () => {
    const data = makeBlockData({
      snapshot: makeSnapshot({
        metricDefs: [makeMetricDef({ id: "burnRate", label: "Burn Rate" })],
        // A real def, and not one department row to draw a bar from.
        points: [
          makeMetricPoint({
            metricId: "burnRate",
            period: "2026-02",
            department: "all",
          }),
        ],
      }),
    });

    const { container } = renderVarianceBar(data, "burnRate");

    const error = container.querySelector('[data-testid="block-error"]');
    expect(error?.getAttribute("role")).toBe("alert");
    expect(error?.textContent ?? "").toMatch(/per-department series/i);
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

  /**
   * THE PER-ROW EXPLAINED TAG. It is what makes this list different from an
   * "awaiting explanation" list (see the empty-state test below): a row that
   * has a filed narrative against it still belongs here, tagged. `explained`
   * is also a SUBSTRING of `unexplained`, so a whole-list `toContain` check
   * passes on either value — the tag has to be read per row.
   */
  it("tags each row explained or unexplained, per row", () => {
    const { container } = renderExceptionList(
      makeBlockData({ snapshot: audienceSnapshot() }),
      {},
    );

    const tagOf = (label: string) => {
      const row = Array.from(container.querySelectorAll("li")).find((li) =>
        li.textContent?.includes(label),
      );
      const spans = Array.from(row?.querySelectorAll("span") ?? []);
      return spans[spans.length - 1]?.textContent;
    };

    // `cash` is the one exception on the fixture with `explained: true`.
    expect(tagOf("Cash")).toBe("explained");
    expect(tagOf("Revenue")).toBe("unexplained");
    expect(tagOf("DSO days")).toBe("unexplained");
  });

  /**
   * COLOUR BY BREACH, NOT BY SIGN — the same rule the CEO dashboard's fixed
   * strip already follows (`../pages/ceo-dashboard.tsx`).
   *
   * Every row here is, by construction, a breach: `store.exceptions()` only
   * ever emits points past `isBreach`'s threshold, in either direction. The
   * shared `Delta` glyph colours by the SIGN of the variance, so an over-plan
   * breach (opex running hot) rendered GREEN in this list while the exact same
   * exception rendered red in the strip directly above it on the CEO page, and
   * red again in the Metrics Explorer. A breach is bad whichever way it went.
   */
  it.each([
    { name: "an over-plan (positive) breach", text: "▲ +11.1%" },
    { name: "an under-plan (negative) breach", text: "▼ -11.1%" },
  ])("colours $name with the alert treatment, not the sign", ({ text }) => {
    const snapshot = audienceSnapshot();
    const sign = text.startsWith("▲") ? 1 : -1;
    const { container } = renderExceptionList(
      makeBlockData({
        snapshot: {
          ...snapshot,
          exceptions: [
            {
              metricId: "revenue",
              period: "2026-02",
              department: "all",
              variancePct: 0.111 * sign,
              explained: false,
            },
          ],
        },
      }),
      { audience: "ceo" },
    );

    const delta = deltaWithText(container, text);
    expect(delta, `expected a "${text}" delta on the row`).toBeDefined();
    expect(delta?.className ?? "").toContain("text-negative");
    expect(delta?.className ?? "").not.toContain("text-positive");
  });

  /**
   * THE EMPTY STATE HAS TO BE TRUE. The list carries EXPLAINED rows as well as
   * unexplained ones (the `explained`/`unexplained` tag on each row is the
   * whole point), so "no variances awaiting explanation" described a different
   * list than the one this block renders: with one explained breach on the
   * ledger the block would go empty and claim there was nothing to explain,
   * which is exactly the sentence a board pack must never print falsely.
   */
  it("says there are no variances — not that none await explanation — when none match", () => {
    const snapshot = audienceSnapshot();
    const { container } = renderExceptionList(
      makeBlockData({ snapshot: { ...snapshot, exceptions: [] } }),
      { audience: "cfo" },
    );
    const text = container.textContent ?? "";

    expect(text).toMatch(/no variances/i);
    expect(text).not.toMatch(/awaiting explanation/i);
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

  /**
   * NO-DATA IS NOT NO-VARIANCE. A ledger with points but no metric DEFS has
   * nothing to classify a breach against — every row is dropped for want of a
   * def — and the block printed "no variances", i.e. "everything is within
   * threshold", about a ledger that cannot say whether anything is.
   */
  it("reports a ledger with points but no metric defs as unavailable, not as no-variance", () => {
    const { container } = renderExceptionList(
      makeBlockData({
        snapshot: makeSnapshot({
          metricDefs: [],
          points: [makeMetricPoint({ metricId: "revenue", period: "2026-02" })],
          exceptions: [
            {
              metricId: "revenue",
              period: "2026-02",
              department: "all",
              variancePct: 0.111,
              explained: false,
            },
          ],
        }),
      }),
      {},
    );

    const error = container.querySelector('[data-testid="block-error"]');
    expect(
      error,
      "a ledger that cannot classify a breach must not claim there are none",
    ).not.toBeNull();
    expect(error?.getAttribute("role")).toBe("alert");
    expect(container.textContent ?? "").not.toMatch(/no variances/i);
  });

  /**
   * THE SEED'S AUDIENCE CONTRACT, at the surface that reads it.
   *
   * Burn rate and DSO are exec-grade: runway and collections are board-pack
   * figures, not CFO-desk-only ones, and the demo's beat-6 replay turns on the
   * CEO's own surfaces carrying a breach. The opex overrun stays CFO-grade —
   * it is a departmental cost line, and beat 3a's memo is the CFO's to file.
   * With all three seeded breaches tagged `cfo`, a CEO-scoped list of the
   * seeded ledger was EMPTY.
   */
  it("surfaces the seeded exec-grade breaches, not the CFO-desk one, on a CEO-scoped list", () => {
    store.reset();
    const { container } = renderExceptionList(
      makeBlockData({ snapshot: store.snapshot() }),
      { audience: "ceo" },
    );
    const text = container.textContent ?? "";

    expect(text).toContain("Burn Rate");
    expect(text).toContain("DSO");
    expect(text).not.toContain("Opex");
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
    // The WHOLE control collapses — pinning is single-home, so a still-live
    // "Pin to CFO dashboard" beside "Pinned ✓" advertises an action
    // `store.addBlockToDashboard` would refuse with ALREADY_PINNED. Asserting
    // only that "Pinned ✓" appeared let exactly that render pass.
    expect(screen.queryByText("Pin to CEO dashboard")).toBeNull();
    expect(screen.queryByText("Pin to CFO dashboard")).toBeNull();
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
