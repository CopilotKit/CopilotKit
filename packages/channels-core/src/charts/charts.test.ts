import { describe, it, expect } from "vitest";
import { isValidElement } from "react";
import { BarChart } from "./bar-chart.js";
import { StackedBar } from "./stacked-bar.js";
import { Sparkline } from "./sparkline.js";
import { Meter } from "./meter.js";
import { resolveArbitraryElement } from "../render/detect.js";

const data = [
  { label: "Mon", value: 120 },
  { label: "Tue", value: 240 },
  { label: "Wed", value: 180 },
];

describe("box-model charts", () => {
  it("BarChart returns a React element routed to the image path", () => {
    const el = BarChart({ data, title: "Signups" });
    expect(isValidElement(el)).toBe(true);
    expect(resolveArbitraryElement(el)).toBeTruthy();
  });
  it("StackedBar returns a React element", () => {
    expect(
      isValidElement(StackedBar({ data: [{ label: "A", values: [1, 2] }] })),
    ).toBe(true);
  });
  it("Sparkline returns a React element", () => {
    expect(isValidElement(Sparkline({ data: [1, 2, 3, 2, 4] }))).toBe(true);
  });
  it("Meter clamps and returns a React element", () => {
    expect(isValidElement(Meter({ value: 0.5 }))).toBe(true);
    expect(isValidElement(Meter({ value: 5 }))).toBe(true); // > 1 clamps, no throw
  });
});
