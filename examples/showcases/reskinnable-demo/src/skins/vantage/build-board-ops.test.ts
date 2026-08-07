import { describe, expect, it } from "vitest";

import {
  BOARD_METRICS,
  buildBoardOps,
  extractBoardBinding,
  extractSurfaceId,
} from "./build-board-ops";
import { DEFAULT_LENS } from "./data/lens";

const spec = {
  title: "Q2 EMEA review",
  kpis: ["nrr", "magic_number"] as const,
  panels: ["trend"] as const,
};

describe("buildBoardOps", () => {
  it("emits a createSurface and an updateComponents for the given surfaceId", () => {
    const ops = buildBoardOps(
      { ...spec, kpis: [...spec.kpis], panels: [...spec.panels] },
      "board-1",
    );
    expect(extractSurfaceId(ops)).toBe("board-1");
    expect(ops.every((op) => op.version === "v0.9")).toBe(true);
  });
});

describe("extractBoardBinding", () => {
  it("reports the lens the spec asked for, not the default lens", () => {
    const ops = buildBoardOps({
      ...spec,
      kpis: [...spec.kpis],
      panels: [...spec.panels],
      period: "q2-2026",
      region: "emea",
      segment: "enterprise",
      currency: "constant",
    });

    expect(extractBoardBinding(ops)?.lens).toEqual({
      ...DEFAULT_LENS,
      period: "q2-2026",
      region: "emea",
      segment: "enterprise",
      currency: "constant",
    });
  });

  it("falls back to the default lens when the spec omits the filters", () => {
    const ops = buildBoardOps({
      ...spec,
      kpis: [...spec.kpis],
      panels: [...spec.panels],
    });
    expect(extractBoardBinding(ops)?.lens).toEqual(DEFAULT_LENS);
  });

  it("reports every StatCard metric, including ones outside DEFAULT_KPIS", () => {
    const ops = buildBoardOps({
      ...spec,
      kpis: [...spec.kpis],
      panels: [...spec.panels],
    });
    // nrr and magic_number are NOT in DEFAULT_KPIS; if the binding drops them
    // the tiles silently vanish from the board the agent just built.
    expect(extractBoardBinding(ops)?.metrics).toEqual(["nrr", "magic_number"]);
  });

  it("accepts every metric the board tool offers", () => {
    const ops = buildBoardOps({
      title: "All",
      kpis: [...BOARD_METRICS],
      panels: [],
    });
    expect(extractBoardBinding(ops)?.metrics).toEqual([...BOARD_METRICS]);
  });

  it("returns null when the ops carry no components", () => {
    expect(extractBoardBinding([])).toBeNull();
  });
});
