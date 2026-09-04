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

describe("exec catalog VarianceBar renderer", () => {
  it("renders exactly one bar per department", () => {
    const departments: Department[] = [
      "manufacturing",
      "distribution",
      "field-services",
      "corporate",
    ];
    // Two periods so the renderer must narrow to the LATEST closed period —
    // if it doesn't, it would render 8 rows (2 periods x 4 departments)
    // instead of 4.
    const points: MetricPoint[] = ["2026-01", "2026-02"].flatMap((period) =>
      departments.map((department) =>
        makeMetricPoint({
          metricId: "opex",
          period,
          department,
          plan: 100,
          actual: 105,
          forecast: 100,
        }),
      ),
    );
    const data = makeBlockData({
      snapshot: makeSnapshot({
        metricDefs: [
          makeMetricDef({ id: "opex", label: "Opex", byDepartment: true }),
        ],
        points,
      }),
    });

    const { container } = renderVarianceBar(data, "opex");

    // Contract: each per-department row is tagged
    // `data-testid="variance-bar-row"` (this app already uses data-testid
    // contracts for DOM-shape tests, e.g. inline-block-surface), so the
    // count is independent of department label text/formatting choices the
    // eventual implementation makes.
    const rows = container.querySelectorAll('[data-testid="variance-bar-row"]');
    expect(rows.length).toBe(4);
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
