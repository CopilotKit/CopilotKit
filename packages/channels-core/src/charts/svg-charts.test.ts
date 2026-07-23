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
    expect(
      isValidElement(PieChart({ data: [{ label: "only", value: 5 }] })),
    ).toBe(true);
    expect(
      isValidElement(
        PieChart({
          data: [
            { label: "a", value: 1 },
            { label: "b", value: 1 },
          ],
        }),
      ),
    ).toBe(true);
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
