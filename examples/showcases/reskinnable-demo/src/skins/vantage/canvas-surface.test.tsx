import type { ReactNode } from "react";
import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { buildBoardOps } from "./build-board-ops";
import { DEFAULT_LENS } from "./data/lens";

/**
 * The defect this file guards: the canvas used to mount BoardDataProvider with
 * no lens, so a board the agent built for "Q2 2026 / EMEA" silently showed
 * Q3 2026 / all-regions figures. The lens rides on the ops; these tests prove it
 * reaches the data layer.
 */

const { useKpis, useSeries, messagesRef } = vi.hoisted(() => ({
  useKpis: vi.fn(),
  useSeries: vi.fn(),
  messagesRef: { current: [] as unknown[] },
}));

vi.mock("./data/hooks", () => ({
  useKpis: (...args: unknown[]) => {
    useKpis(...args);
    return { kpis: [], loading: false };
  },
  useSeries: (...args: unknown[]) => {
    useSeries(...args);
    return { series: null, breakdown: [], waterfall: [], loading: false };
  },
}));

vi.mock("@copilotkit/react-core/v2", () => ({
  useAgent: () => ({ agent: { messages: messagesRef.current } }),
}));

vi.mock("@copilotkit/a2ui-renderer", () => ({
  A2UIProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
  A2UIRenderer: ({ surfaceId }: { surfaceId: string | null }) => (
    <div data-testid="a2ui-rendered">{surfaceId}</div>
  ),
  createCatalog: () => ({}),
  extractSchema: () => ({}),
  useA2UIActions: () => ({
    processMessages: vi.fn(),
    getSurface: vi.fn(() => undefined),
  }),
}));

const activityFor = (ops: unknown[]) => [
  {
    role: "activity",
    activityType: "a2ui-surface",
    content: { a2ui_operations: ops },
  },
];

describe("VantageCanvasSurface lens binding", () => {
  beforeEach(() => {
    useKpis.mockClear();
    useSeries.mockClear();
    messagesRef.current = [];
  });
  afterEach(cleanup);

  it("binds the lens the agent asked for, not DEFAULT_LENS", async () => {
    messagesRef.current = activityFor(
      buildBoardOps({
        title: "Q2 EMEA review",
        kpis: ["nrr", "magic_number"],
        panels: ["trend"],
        period: "q2-2026",
        region: "emea",
        currency: "constant",
      }),
    );
    const { VantageCanvasSurface } = await import("./canvas-surface");
    render(<VantageCanvasSurface />);

    const expected = {
      ...DEFAULT_LENS,
      period: "q2-2026",
      region: "emea",
      currency: "constant",
    };
    expect(useKpis).toHaveBeenCalledWith(expected, expect.anything());
    expect(useSeries).toHaveBeenCalledWith(expected, "arr", "segment");
    expect(useSeries).toHaveBeenCalledWith(expected, "arr", "region");
  });

  it("requests the board's own metrics so non-default KPIs still render", async () => {
    messagesRef.current = activityFor(
      buildBoardOps({
        title: "Retention",
        kpis: ["nrr", "magic_number"],
        panels: [],
      }),
    );
    const { VantageCanvasSurface } = await import("./canvas-surface");
    render(<VantageCanvasSurface />);

    expect(useKpis).toHaveBeenCalledWith(DEFAULT_LENS, ["nrr", "magic_number"]);
  });

  it("falls back to the default lens when no board surface is present", async () => {
    const { VantageCanvasSurface } = await import("./canvas-surface");
    render(<VantageCanvasSurface />);
    expect(useKpis).toHaveBeenCalledWith(DEFAULT_LENS, undefined);
  });
});
