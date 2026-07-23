import { describe, it, expect } from "vitest";
import { isValidElement } from "react";
import { LineChart } from "./line-chart.js";
import { PieChart } from "./pie-chart.js";
import { Scatter } from "./scatter.js";
import { DEFAULT_CHART_COLORS } from "./types.js";
import { resolveArbitraryElement } from "../render/detect.js";

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
    interface PieElement {
      type: unknown;
      props: { children: unknown };
    }
    const findByType = (el: PieElement, type: string): PieElement[] => {
      const children = ([] as unknown[]).concat(
        el.props?.children as unknown,
      ) as PieElement[];
      const matches: PieElement[] = [];
      for (const child of children) {
        if (!child || typeof child !== "object") continue;
        if (child.type === type) matches.push(child);
        matches.push(...findByType(child, type));
      }
      return matches;
    };

    const single = PieChart({ data: [{ label: "only", value: 5 }] });
    expect(isValidElement(single)).toBe(true);
    expect(findByType(single as unknown as PieElement, "circle").length).toBe(
      1,
    );

    const twoSlice = PieChart({
      data: [
        { label: "a", value: 1 },
        { label: "b", value: 1 },
      ],
    });
    expect(isValidElement(twoSlice)).toBe(true);
    expect(findByType(twoSlice as unknown as PieElement, "path").length).toBe(
      2,
    );
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
});
