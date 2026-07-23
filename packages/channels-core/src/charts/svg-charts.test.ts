import { describe, it, expect } from "vitest";
import { isValidElement } from "react";
import { LineChart } from "./line-chart.js";
import { PieChart } from "./pie-chart.js";
import { Scatter } from "./scatter.js";
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
});
