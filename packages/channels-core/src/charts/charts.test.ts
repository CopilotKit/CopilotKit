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
  it("Sparkline with no data returns a valid element without crashing", () => {
    const el = Sparkline({ data: [] });
    expect(isValidElement(el)).toBe(true);
  });
  it("BarChart clamps a negative value's bar to 0% height", () => {
    const el = BarChart({
      data: [
        { label: "a", value: -5 },
        { label: "b", value: 10 },
      ],
    });
    interface BarElement {
      props: { children: unknown };
    }
    const bars = (
      (el as unknown as BarElement).props.children as BarElement[]
    ).at(-1) as BarElement;
    const [negativeBarWrapper, positiveBarWrapper] = bars.props
      .children as BarElement[];
    const negativeBarHeight = (
      (negativeBarWrapper!.props.children as BarElement[])[1]!
        .props as unknown as {
        style: { height: string };
      }
    ).style.height;
    const positiveBarHeight = (
      (positiveBarWrapper!.props.children as BarElement[])[1]!
        .props as unknown as {
        style: { height: string };
      }
    ).style.height;
    expect(negativeBarHeight).toBe("0%");
    expect(parseFloat(positiveBarHeight)).toBeGreaterThan(0);
  });
  it("Meter clamps and returns a React element", () => {
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

    const mid = Meter({ value: 0.5 });
    expect(isValidElement(mid)).toBe(true);
    expect(innerBarWidth(mid as unknown as MeterElement)).toBe("50%");

    const over = Meter({ value: 5 }); // > 1 clamps, no throw
    expect(isValidElement(over)).toBe(true);
    expect(innerBarWidth(over as unknown as MeterElement)).toBe("100%");

    const under = Meter({ value: -5 }); // < 0 clamps, no throw
    expect(innerBarWidth(under as unknown as MeterElement)).toBe("0%");
  });

  it("BarChart clamps a non-finite (NaN) value's bar to 0% while a finite bar renders > 0%", () => {
    const el = BarChart({
      data: [
        { label: "a", value: NaN },
        { label: "b", value: 10 },
      ],
    });
    interface BarElement {
      props: { children: unknown };
    }
    const bars = (
      (el as unknown as BarElement).props.children as BarElement[]
    ).at(-1) as BarElement;
    const [nanBarWrapper, finiteBarWrapper] = bars.props
      .children as BarElement[];
    const nanBarHeight = (
      (nanBarWrapper!.props.children as BarElement[])[1]!.props as unknown as {
        style: { height: string };
      }
    ).style.height;
    const finiteBarHeight = (
      (finiteBarWrapper!.props.children as BarElement[])[1]!
        .props as unknown as {
        style: { height: string };
      }
    ).style.height;
    expect(nanBarHeight).toBe("0%");
    expect(parseFloat(finiteBarHeight)).toBeGreaterThan(0);
  });

  it("Meter clamps a non-finite (NaN) value's inner bar to 0% width", () => {
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
    const el = Meter({ value: NaN });
    expect(isValidElement(el)).toBe(true);
    expect(innerBarWidth(el as unknown as MeterElement)).toBe("0%");
  });
});
