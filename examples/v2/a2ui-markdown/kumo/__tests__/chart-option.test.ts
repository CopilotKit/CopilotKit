import { describe, expect, test } from "vitest";
import { ChartPalette } from "@cloudflare/kumo";
import {
  legendItemsOf,
  makeFormatter,
  seriesColorOf,
  toEChartsOption,
} from "../chart-option";

const palette = [0, 1, 2, 3, 4, 5].map((index) =>
  ChartPalette.categorical(index, false),
);
const months = [
  { month: "Jan", revenue: 10, orders: 3 },
  { month: "Feb", revenue: 20, orders: 5 },
];

describe("toEChartsOption: cartesian", () => {
  test("a bar chart by default, one series per number field", () => {
    const option = toEChartsOption({ data: months, xKey: "month" }, palette);
    expect(option.xAxis).toMatchObject({
      type: "category",
      data: ["Jan", "Feb"],
    });
    expect(option.yAxis).toMatchObject({ type: "value" });
    expect(option.series.map((series) => series.type)).toEqual(["bar", "bar"]);
    expect(option.series.map((series) => series.name)).toEqual([
      "revenue",
      "orders",
    ]);
    expect(option.series[0].data).toEqual([10, 20]);
  });

  test("series pick the fields and labels", () => {
    const option = toEChartsOption(
      {
        data: months,
        xKey: "month",
        series: [{ key: "orders", label: "Orders" }],
      },
      palette,
    );
    expect(option.series.map((series) => series.name)).toEqual(["Orders"]);
    expect(option.series[0].data).toEqual([3, 5]);
  });

  test("stacked series share one stack and lose the bar radius", () => {
    const option = toEChartsOption(
      { data: months, xKey: "month", stacked: true },
      palette,
    );
    expect(option.series.every((series) => series.stack === "total")).toBe(
      true,
    );
    expect(option.series[0].itemStyle?.borderRadius).toBe(0);
  });

  test("a vertical bar has rounded top corners", () => {
    const option = toEChartsOption({ data: months, xKey: "month" }, palette);
    expect(option.series[0].itemStyle?.borderRadius).toEqual([4, 4, 0, 0]);
  });

  test("a horizontal layout swaps the axes", () => {
    const option = toEChartsOption(
      { data: months, xKey: "month", layout: "horizontal" },
      palette,
    );
    expect(option.yAxis).toMatchObject({
      type: "category",
      data: ["Jan", "Feb"],
    });
    expect(option.xAxis).toMatchObject({ type: "value" });
  });

  test("an area chart is a line with an area", () => {
    const option = toEChartsOption(
      { data: months, xKey: "month", chartType: "area" },
      palette,
    );
    expect(option.series[0].type).toBe("line");
    expect(option.series[0].areaStyle).toBeDefined();
  });

  test("a line shows dots only when asked", () => {
    const plain = toEChartsOption(
      { data: months, xKey: "month", chartType: "line" },
      palette,
    );
    const dotted = toEChartsOption(
      { data: months, xKey: "month", chartType: "line", showDots: true },
      palette,
    );
    expect(plain.series[0].showSymbol).toBe(false);
    expect(dotted.series[0].showSymbol).toBe(true);
  });

  test("the value axis takes the yAxis label and bounds", () => {
    const option = toEChartsOption(
      {
        data: months,
        xKey: "month",
        yAxis: { label: "Revenue", min: 0, max: 50 },
      },
      palette,
    );
    expect(option.yAxis).toMatchObject({ name: "Revenue", min: 0, max: 50 });
  });

  test("scatter points are [x, y] pairs on a value axis", () => {
    const option = toEChartsOption(
      {
        data: [
          { x: 1, y: 2 },
          { x: 3, y: 4 },
        ],
        xKey: "x",
        chartType: "scatter",
      },
      palette,
    );
    expect(option.xAxis).toMatchObject({ type: "value" });
    expect(option.series[0].type).toBe("scatter");
    expect(option.series[0].data).toEqual([
      [1, 2],
      [3, 4],
    ]);
  });

  test("no data gives no series", () => {
    expect(toEChartsOption({}, palette).series).toEqual([]);
  });
});

describe("toEChartsOption: pie and donut", () => {
  const spend = [
    { category: "Food", amount: 30 },
    { category: "Transport", amount: 20 },
  ];

  test("pie slices take the xKey as name and the first series as value", () => {
    const option = toEChartsOption(
      { data: spend, xKey: "category", chartType: "pie" },
      palette,
    );
    expect(option.series[0].type).toBe("pie");
    expect(option.series[0].data).toEqual([
      { name: "Food", value: 30 },
      { name: "Transport", value: 20 },
    ]);
    expect(option.series[0].radius).toEqual([0, "80%"]);
  });

  test("leaves unset pie options out, so ECharts uses its defaults", () => {
    const option = toEChartsOption(
      { data: spend, xKey: "category", chartType: "donut" },
      palette,
    );
    expect("padAngle" in option.series[0]).toBe(false);
  });

  test("a paddingAngle is the gap between slices", () => {
    const option = toEChartsOption(
      { data: spend, xKey: "category", chartType: "donut", paddingAngle: 2 },
      palette,
    );
    expect(option.series[0].padAngle).toBe(2);
  });

  test("a donut has an inner radius", () => {
    const option = toEChartsOption(
      { data: spend, xKey: "category", chartType: "donut" },
      palette,
    );
    expect(option.series[0].radius).toEqual(["55%", "80%"]);
  });
});

describe("makeFormatter", () => {
  test("currency formats like the standard Chart", () => {
    const format = makeFormatter("currency", undefined);
    expect(format?.(1234)).toBe("$1,234");
    expect(format?.(12000)).toBe("$12K");
  });

  test("percent reads fractions", () => {
    expect(makeFormatter("percent", undefined)?.(0.4)).toBe("40%");
  });

  test("no format gives no formatter", () => {
    expect(makeFormatter(undefined, undefined)).toBeUndefined();
  });
});

describe("seriesColorOf", () => {
  test("a danger series is Kumo's attention color", () => {
    expect(seriesColorOf("danger", 0, palette)).toBe(
      ChartPalette.semantic("Attention", false),
    );
  });

  test("a CSS color passes through", () => {
    expect(seriesColorOf("#ff0000", 0, palette)).toBe("#ff0000");
  });

  test("no color takes the palette color of the index", () => {
    expect(seriesColorOf(undefined, 7, palette)).toBe(
      palette[7 % palette.length],
    );
  });
});

describe("legendItemsOf", () => {
  test("lists each series with its color and no value", () => {
    // A total is wrong for rates, averages and prices, so a series shows
    // no value.
    const option = toEChartsOption({ data: months, xKey: "month" }, palette);
    expect(legendItemsOf(option, undefined)).toEqual([
      { name: "revenue", color: palette[0], value: "" },
      { name: "orders", color: palette[1], value: "" },
    ]);
  });

  test("formats the slice values", () => {
    const option = toEChartsOption(
      {
        data: [{ category: "Food", amount: 1234 }],
        xKey: "category",
        chartType: "pie",
        format: "currency",
      },
      palette,
    );
    expect(legendItemsOf(option, makeFormatter("currency", undefined))).toEqual(
      [{ name: "Food", color: palette[0], value: "$1,234" }],
    );
  });

  test("lists each pie slice", () => {
    const option = toEChartsOption(
      {
        data: [
          { category: "Food", amount: 30 },
          { category: "Transport", amount: 20 },
        ],
        xKey: "category",
        chartType: "pie",
      },
      palette,
    );
    expect(legendItemsOf(option, undefined)).toEqual([
      { name: "Food", color: palette[0], value: "30" },
      { name: "Transport", color: palette[1], value: "20" },
    ]);
  });
});
