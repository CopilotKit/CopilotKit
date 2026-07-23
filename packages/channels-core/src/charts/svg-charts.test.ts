import { describe, it, expect } from "vitest";
import { isValidElement } from "react";
import { LineChart } from "./line-chart.js";
import { PieChart } from "./pie-chart.js";
import { Scatter } from "./scatter.js";
import { StackedBar } from "./stacked-bar.js";
import { DEFAULT_CHART_COLORS } from "./types.js";
import { resolveArbitraryElement } from "../render/detect.js";

interface ElementLike {
  type: unknown;
  props: { children: unknown };
}
const findAllByType = (el: ElementLike, type: string): ElementLike[] => {
  const children = ([] as unknown[]).concat(
    el.props?.children as unknown,
  ) as ElementLike[];
  const matches: ElementLike[] = [];
  for (const child of children) {
    if (!child || typeof child !== "object") continue;
    if (child.type === type) matches.push(child);
    matches.push(...findAllByType(child, type));
  }
  return matches;
};

describe("svg charts", () => {
  it("LineChart returns a React element", () => {
    const el = LineChart({
      data: [
        { label: "a", value: 1 },
        { label: "b", value: 3 },
      ],
    });
    expect(isValidElement(el)).toBe(true);
    expect(resolveArbitraryElement(el)).toBeTruthy();
  });
  it("PieChart returns a React element and handles a single slice", () => {
    const single = PieChart({ data: [{ label: "only", value: 5 }] });
    expect(isValidElement(single)).toBe(true);
    expect(
      findAllByType(single as unknown as ElementLike, "circle").length,
    ).toBe(1);

    const twoSlice = PieChart({
      data: [
        { label: "a", value: 1 },
        { label: "b", value: 1 },
      ],
    });
    expect(isValidElement(twoSlice)).toBe(true);
    expect(
      findAllByType(twoSlice as unknown as ElementLike, "path").length,
    ).toBe(2);
  });
  it("Scatter returns a React element", () => {
    const el = Scatter({
      points: [
        { x: 1, y: 2 },
        { x: 3, y: 1 },
      ],
    });
    expect(isValidElement(el)).toBe(true);
    expect(resolveArbitraryElement(el)).toBeTruthy();
  });

  it("PieChart with no data renders an empty svg (no circle/path marks)", () => {
    const el = PieChart({ data: [] });
    expect(isValidElement(el)).toBe(true);
    const asElementLike = el as unknown as ElementLike;
    expect(findAllByType(asElementLike, "circle")).toHaveLength(0);
    expect(findAllByType(asElementLike, "path")).toHaveLength(0);
  });

  it("PieChart colors the single positive slice by its original data index", () => {
    const el = PieChart({
      data: [
        { label: "a", value: 0 },
        { label: "b", value: 5 },
      ],
    });
    const circles = findAllByType(el as unknown as ElementLike, "circle");
    expect(circles).toHaveLength(1);
    const circleProps = circles[0]!.props as unknown as {
      style: { fill: string };
    };
    expect(circleProps.style.fill).toBe(DEFAULT_CHART_COLORS[1]);
  });

  it("Scatter with no points renders an empty svg", () => {
    const el = Scatter({ points: [] });
    expect(isValidElement(el)).toBe(true);
    expect(findAllByType(el as unknown as ElementLike, "circle")).toHaveLength(
      0,
    );
  });

  it("Scatter with a degenerate x-axis (all same x) renders circles with finite, centered cx", () => {
    const el = Scatter({
      points: [
        { x: 5, y: 1 },
        { x: 5, y: 9 },
      ],
      width: 360,
    });
    const circles = findAllByType(el as unknown as ElementLike, "circle");
    expect(circles).toHaveLength(2);
    for (const c of circles) {
      const cx = (c.props as unknown as { cx: number }).cx;
      expect(Number.isFinite(cx)).toBe(true);
      // Degenerate axis collapses every point to the horizontal center:
      // pad + (width - pad*2)/2 = 12 + (360 - 24)/2 = 180.
      expect(cx).toBe(180);
    }
  });

  it("StackedBar with an all-zero-total column renders no NaN heights", () => {
    const el = StackedBar({ data: [{ label: "z", values: [0, 0] }] });
    expect(isValidElement(el)).toBe(true);
    const divs = findAllByType(el as unknown as ElementLike, "div");
    // Every div that carries a height must be a well-formed percentage, never NaN.
    for (const d of divs) {
      const height = (d.props as unknown as { style?: { height?: string } })
        .style?.height;
      if (typeof height === "string") {
        expect(height).not.toContain("NaN");
      }
    }
  });

  it("LineChart with empty data renders an svg with no data marks (empty polyline, no points)", () => {
    const el = LineChart({ data: [] });
    expect(isValidElement(el)).toBe(true);
    const asElementLike = el as unknown as ElementLike;
    // No per-datum circle markers.
    expect(findAllByType(asElementLike, "circle")).toHaveLength(0);
    // The polyline exists but carries no points.
    const polylines = findAllByType(asElementLike, "polyline");
    expect(polylines).toHaveLength(1);
    expect((polylines[0]!.props as unknown as { points: string }).points).toBe(
      "",
    );
  });

  it("palette fallback: a chart with colors:[] still uses DEFAULT_CHART_COLORS[0]", () => {
    const el = LineChart({
      data: [
        { label: "a", value: 1 },
        { label: "b", value: 2 },
      ],
      colors: [],
    });
    const polylines = findAllByType(el as unknown as ElementLike, "polyline");
    expect(polylines).toHaveLength(1);
    const stroke = (
      polylines[0]!.props as unknown as { style: { stroke: string } }
    ).style.stroke;
    expect(stroke).toBe(DEFAULT_CHART_COLORS[0]);
  });

  it("style background override: PieChart style.backgroundColor lands on the wrapper element (F1)", () => {
    const el = PieChart({
      data: [
        { label: "a", value: 1 },
        { label: "b", value: 2 },
      ],
      style: { backgroundColor: "#0f172a" },
    });
    const rootStyle = (
      el as unknown as { props: { style: { backgroundColor: string } } }
    ).props.style;
    expect(rootStyle.backgroundColor).toBe("#0f172a");
  });
});
