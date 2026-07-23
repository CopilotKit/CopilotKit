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

    interface MeterElement {
      props: { children: unknown };
    }
    const innerBarWidth = (el: MeterElement): unknown => {
      const children = el.props.children as unknown[];
      const barOuter = children.at(-1) as MeterElement;
      const barInner = barOuter.props.children as {
        props: { style: { width: string } };
      };
      return barInner.props.style.width;
    };

    const over = Meter({ value: 5 }); // > 1 clamps, no throw
    expect(isValidElement(over)).toBe(true);
    expect(innerBarWidth(over as unknown as MeterElement)).toBe("100%");

    const under = Meter({ value: -5 }); // < 0 clamps, no throw
    expect(innerBarWidth(under as unknown as MeterElement)).toBe("0%");
  });
});
