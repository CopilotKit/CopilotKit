import { TestBed } from "@angular/core/testing";
import { describe, expect, it, vi } from "vitest";
import {
  renderSurface,
  updateComponents,
  updateDataModel,
} from "../../../__tests__/render";
import { byText } from "../../../__tests__/dom";
import { standardUI } from "../../index";
import { GENERATIVE_UI_CHART_LOADER } from "../../loaders";
import { chartConfig } from "../index";
import { rowTexts, ui } from "./helpers";

describe("Chart", () => {
  const chart = {
    id: "root",
    component: "Chart",
    title: "Cost",
    xKey: "month",
    format: "currency",
    data: [
      { month: "Jan", cost: 290 },
      { month: "Feb", cost: 580 },
    ],
    series: [{ key: "cost", label: "Monthly cost" }],
  };

  it("shows the data as a table when chart.js is not provided, next to the hidden table for screen readers", () => {
    const view = renderSurface(ui, [chart]);
    const figure = view.container.querySelector("figure")!;
    expect(figure.querySelector("figcaption")?.textContent).toBe("Cost");
    const area = figure.querySelector('[data-a2ui-chart="bar"]')!;
    expect(area.getAttribute("aria-hidden")).toBe("true");
    expect(rowTexts(view, "[data-a2ui-chart] table")).toEqual([
      "month|Monthly cost",
      "Jan|$290",
      "Feb|$580",
    ]);
    const tables = figure.querySelectorAll("table");
    expect(tables).toHaveLength(2);
    expect((tables[1] as HTMLElement).style.position).toBe("absolute");
  });

  it("charts every number field except xKey when series is not set", () => {
    const view = renderSurface(ui, [
      {
        id: "root",
        component: "Chart",
        chartType: "line",
        xKey: "day",
        data: [{ day: "Mon", food: 3, rent: 10, note: "x" }],
      },
    ]);
    expect(rowTexts(view, "[data-a2ui-chart] table")).toEqual([
      "day|food|rent",
      "Mon|3|10",
    ]);
  });

  it("draws with chart.js when a loader is provided, and redraws when the data changes", async () => {
    const instances: Array<{
      config: Record<string, unknown>;
      destroyed: boolean;
    }> = [];
    class FakeChart {
      destroyed = false;
      constructor(
        _canvas: HTMLCanvasElement,
        readonly config: Record<string, unknown>,
      ) {
        instances.push(this);
      }
      destroy() {
        this.destroyed = true;
      }
    }
    TestBed.configureTestingModule({
      providers: [
        {
          provide: GENERATIVE_UI_CHART_LOADER,
          useValue: () => Promise.resolve({ Chart: FakeChart }),
        },
      ],
    });
    const view = renderSurface(ui, [chart]);
    await vi.waitFor(() => {
      view.detectChanges();
      expect(instances).toHaveLength(1);
    });
    expect(view.container.querySelector("canvas")).not.toBeNull();
    const config = instances[0]!.config as {
      type: string;
      data: {
        labels: string[];
        datasets: Array<{ label: string; data: unknown[] }>;
      };
    };
    expect(config.type).toBe("bar");
    expect(config.data.labels).toEqual(["Jan", "Feb"]);
    expect(config.data.datasets[0]).toMatchObject({
      label: "Monthly cost",
      data: [290, 580],
    });
    // The same content again does not redraw; new data does.
    view.update(updateDataModel("/x", 1));
    expect(instances).toHaveLength(1);
    view.update(
      updateComponents({ ...chart, data: [{ month: "Mar", cost: 1 }] }),
    );
    expect(instances).toHaveLength(2);
    expect(instances[0]!.destroyed).toBe(true);
  });

  it("draws value labels with an inline plugin when showValueLabels is set", () => {
    const element = document.createElement("div");
    const data = [
      { q: "Q1", a: 1 },
      { q: "Q2", a: 2 },
    ];
    expect(chartConfig({ data, xKey: "q" }, element).plugins).toBeUndefined();
    const { plugins } = chartConfig(
      { data, xKey: "q", showValueLabels: true, format: "percent" },
      element,
    ) as {
      plugins: { id: string; afterDatasetsDraw: (chart: unknown) => void }[];
    };
    expect(plugins.map((plugin) => plugin.id)).toEqual(["a2uiValueLabels"]);
    const ctx = {
      save: vi.fn(),
      restore: vi.fn(),
      fillText: vi.fn(),
      beginPath: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      stroke: vi.fn(),
    };
    const chart = (type: string, points: object[], indexAxis = "x") => ({
      ctx,
      data: { datasets: [{ data: [1, 2] }] },
      options: { indexAxis },
      getDatasetMeta: () => ({ hidden: false, type, data: points }),
    });
    const draw = plugins[0]!.afterDatasetsDraw;

    // Above each bar, formatted like the axis.
    draw(
      chart("bar", [
        { x: 10, y: 20 },
        { x: 30, y: 40 },
      ]),
    );
    expect(ctx.fillText.mock.calls).toEqual([
      ["100%", 10, 16],
      ["200%", 30, 36],
    ]);
    // Next to the bar end in a horizontal layout.
    ctx.fillText.mockClear();
    draw(chart("bar", [{ x: 10, y: 20 }], "y"));
    expect(ctx.fillText.mock.calls).toEqual([["100%", 14, 20]]);
    // Outside a slice, with a line from the arc.
    ctx.fillText.mockClear();
    const arc = {
      x: 0,
      y: 0,
      getProps: () => ({
        x: 50,
        y: 50,
        startAngle: 0,
        endAngle: Math.PI,
        outerRadius: 40,
      }),
    };
    draw(chart("pie", [arc]));
    expect(ctx.stroke).toHaveBeenCalledTimes(1);
    const [label, x, y] = ctx.fillText.mock.calls[0] as [
      string,
      number,
      number,
    ];
    expect(label).toBe("100%");
    expect(x).toBeCloseTo(53);
    expect(y).toBeCloseTo(102);
  });

  it("maps the props to a chart.js config: series, horizontal bars and donut", () => {
    const element = document.createElement("div");
    const bars = chartConfig(
      {
        data: [
          { q: "Q1", a: 1, b: 2 },
          { q: "Q2", a: 3, b: 4 },
        ],
        xKey: "q",
        layout: "horizontal",
        stacked: true,
        yAxis: { label: "Revenue", min: 0, max: 10 },
        format: "percent",
      },
      element,
    ) as {
      type: string;
      data: { datasets: Array<{ label: string }> };
      options: {
        indexAxis: string;
        scales: {
          x: {
            min: number;
            max: number;
            stacked: boolean;
            title: { text: string };
          };
        };
      };
    };
    // Every number field except xKey is a series.
    expect(bars.data.datasets.map((dataset) => dataset.label)).toEqual([
      "a",
      "b",
    ]);
    expect(bars.options.indexAxis).toBe("y");
    expect(bars.options.scales.x).toMatchObject({
      min: 0,
      max: 10,
      stacked: true,
      title: { text: "Revenue" },
    });
    const donut = chartConfig(
      {
        chartType: "donut",
        data: [
          { name: "A", share: 0.6 },
          { name: "B", share: 0.4 },
        ],
        xKey: "name",
      },
      element,
    ) as {
      type: string;
      data: { labels: string[] };
      options: { cutout: string };
    };
    expect(donut.type).toBe("doughnut");
    expect(donut.data.labels).toEqual(["A", "B"]);
    expect(donut.options.cutout).toBe("55%");
  });

  it.each([
    ["vertical", { x: 0, y: 0.25 }],
    ["horizontal", { x: 0.25, y: 0 }],
  ] as const)(
    "formats the measured value in the %s bar tooltip",
    (layout, parsed) => {
      const config = chartConfig(
        { data: [{ q: "Q1", a: 0.25 }], xKey: "q", layout, format: "percent" },
        document.createElement("div"),
      ) as {
        options: {
          plugins: {
            tooltip: {
              callbacks: {
                label: (context: {
                  dataset: { label?: string };
                  parsed: unknown;
                  raw: unknown;
                }) => string;
              };
            };
          };
        };
      };
      const label = config.options.plugins.tooltip.callbacks.label({
        dataset: { label: "a" },
        parsed,
        raw: 0.25,
      });
      expect(label).toBe("a: 25%");
    },
  );
});

/**
 * The value labels plugin draws on a fake canvas, so the labels and the
 * leader lines are what `fillText` and `stroke` got.
 */
describe.each(["donut", "pie"] as const)(
  "Chart %s slice labels",
  (chartType) => {
    const element = document.createElement("div");
    const data = [
      { name: "First", amount: 0.4 },
      { name: "Second", amount: 0.35 },
      { name: "Third", amount: 0.25 },
    ];
    const props = {
      chartType,
      data,
      xKey: "name",
      series: ["amount"],
      showLegend: false,
      showTooltip: false,
      showValueLabels: true,
    };
    type Plugin = { afterDatasetsDraw: (chart: unknown) => void };

    /** Draws the slices of `config`: the labels, their positions and the line count. */
    function drawSlices(config: Record<string, unknown>) {
      const plugins = config["plugins"] as Plugin[] | undefined;
      const fillText = vi.fn();
      const stroke = vi.fn();
      const ctx = {
        save: vi.fn(),
        restore: vi.fn(),
        fillText,
        beginPath: vi.fn(),
        moveTo: vi.fn(),
        lineTo: vi.fn(),
        stroke,
      };
      const { datasets } = config["data"] as { datasets: { data: number[] }[] };
      const arcs = datasets[0]!.data.map((_, index) => ({
        x: 0,
        y: 0,
        getProps: () => ({
          x: 50,
          y: 50,
          startAngle: index * 2,
          endAngle: index * 2 + 2,
          outerRadius: 40,
        }),
      }));
      plugins?.[0]?.afterDatasetsDraw({
        ctx,
        data: { datasets },
        options: { indexAxis: "x" },
        getDatasetMeta: () => ({
          hidden: false,
          type: chartType === "pie" ? "pie" : "doughnut",
          data: arcs,
        }),
      });
      return {
        labels: fillText.mock.calls.map((call) => call[0] as string),
        positions: fillText.mock.calls.map((call) => [call[1], call[2]]),
        lines: stroke.mock.calls.length,
      };
    }

    it("formats fractional values as percentages in the drawn labels", () => {
      const drawn = drawSlices(
        chartConfig({ ...props, format: "percent" }, element),
      );
      expect(drawn.labels).toEqual(["40%", "35%", "25%"]);
      expect(drawn.lines).toBe(3);
    });

    it("uses the requested currency for the rendered slice values", () => {
      const drawn = drawSlices(
        chartConfig(
          {
            ...props,
            data: data.map((row) => ({ ...row, amount: row.amount * 100 })),
            format: "currency",
            currency: "EUR",
          },
          element,
        ),
      );
      expect(drawn.labels).toEqual(["€40", "€35", "€25"]);
    });

    it("preserves raw values and label positions when formatting is absent", () => {
      const raw = drawSlices(chartConfig(props, element));
      expect(raw.labels).toEqual(["0.4", "0.35", "0.25"]);
      const formatted = drawSlices(
        chartConfig({ ...props, format: "percent" }, element),
      );
      expect(formatted.labels[0]).toBe("40%");
      expect(formatted.positions).toEqual(raw.positions);
    });

    it.each([false, undefined])(
      "hides labels and leader lines when showValueLabels is %s",
      (showValueLabels) => {
        const config = chartConfig(
          { ...props, format: "percent", showValueLabels },
          element,
        );
        expect(config["plugins"]).toBeUndefined();
        const drawn = drawSlices(config);
        expect(drawn.labels).toHaveLength(0);
        expect(drawn.lines).toBe(0);
      },
    );

    it("can hide leader lines while keeping formatted labels", () => {
      const drawn = drawSlices(
        chartConfig(
          { ...props, format: "percent", showLabelLines: false },
          element,
        ),
      );
      expect(drawn.labels).toEqual(["40%", "35%", "25%"]);
      expect(drawn.lines).toBe(0);
    });
  },
);

describe("Chart scatter spacing", () => {
  const element = document.createElement("div");
  type Axis = {
    type: string;
    min?: number;
    max?: number;
    title?: { text: string };
    ticks: { callback?: (value: unknown) => string };
  };
  type Config = {
    data: {
      labels?: string[];
      datasets: { label: string; data: Array<{ x: unknown; y: unknown }> }[];
    };
    options: { indexAxis: string; scales: { x: Axis; y: Axis } };
  };
  const configOf = (props: Parameters<typeof chartConfig>[0]) =>
    chartConfig(
      { height: 300, showLegend: false, showTooltip: false, ...props },
      element,
    ) as unknown as Config;
  /** The axis of the categories (x values), by layout. */
  const categoryAxis = (config: Config) =>
    config.options.indexAxis === "y"
      ? config.options.scales.y
      : config.options.scales.x;
  const valueAxis = (config: Config) =>
    config.options.indexAxis === "y"
      ? config.options.scales.x
      : config.options.scales.y;
  const xValues = (config: Config, dataset = 0) =>
    config.data.datasets[dataset]!.data.map((point) => point.x);

  it.each(["vertical", "horizontal"] as const)(
    "spaces numeric xKey values continuously in %s layout",
    (layout) => {
      const config = configOf({
        chartType: "scatter",
        layout,
        xKey: "amount",
        data: [100, 200, 400, 800].map((amount) => ({ amount, score: 10 })),
      });
      expect(config.options.indexAxis).toBe(
        layout === "horizontal" ? "y" : "x",
      );
      // A linear axis keeps the distances; a category axis would not.
      expect(categoryAxis(config).type).toBe("linear");
      expect(config.data.labels).toBeUndefined();
      expect(xValues(config)).toEqual([100, 200, 400, 800]);
    },
  );

  it.each(["vertical", "horizontal"] as const)(
    "positions unsorted data for multiple series and preserves the value axis in %s layout",
    (layout) => {
      const data = [400, 100, 800, 200].map((amount) => ({
        amount,
        first: amount / 1000,
        second: amount / 2000,
        ignored: amount * 2,
      }));
      const config = configOf({
        chartType: "scatter",
        layout,
        xKey: "amount",
        data,
        series: ["first", { key: "second", label: "Second series" }],
        yAxis: { min: 0, max: 1, width: 72, label: "Share" },
        format: "percent",
      });
      expect(config.data.datasets.map((dataset) => dataset.label)).toEqual([
        "first",
        "Second series",
      ]);
      // The points keep the data order and their own x value.
      expect(xValues(config, 0)).toEqual([400, 100, 800, 200]);
      expect(config.data.datasets[0]!.data.map((point) => point.y)).toEqual([
        0.4, 0.1, 0.8, 0.2,
      ]);
      expect(config.data.datasets[1]!.data.map((point) => point.y)).toEqual([
        0.2, 0.05, 0.4, 0.1,
      ]);
      const axis = valueAxis(config);
      expect(axis).toMatchObject({ min: 0, max: 1, title: { text: "Share" } });
      expect(axis.ticks.callback?.(1)).toBe("100%");
    },
  );

  it.each(["vertical", "horizontal"] as const)(
    "keeps string xKey values categorical in %s layout",
    (layout) => {
      const config = configOf({
        chartType: "scatter",
        layout,
        xKey: "category",
        data: ["100", "200", "400", "800"].map((category) => ({
          category,
          score: 10,
        })),
      });
      expect(categoryAxis(config).type).toBe("category");
      expect(config.data.labels).toEqual(["100", "200", "400", "800"]);
      expect(xValues(config)).toEqual([0, 1, 2, 3]);
    },
  );

  it("keeps mixed numeric and string scatter values categorical", () => {
    const config = configOf({
      chartType: "scatter",
      xKey: "amount",
      data: [100, "200", 400, 800].map((amount) => ({ amount, score: 10 })),
    });
    expect(categoryAxis(config).type).toBe("category");
    expect(xValues(config)).toEqual([0, 1, 2, 3]);
  });

  it.each(["bar", "line"] as const)(
    "keeps numeric xKey values categorical for %s charts",
    (chartType) => {
      const config = configOf({
        chartType,
        xKey: "amount",
        showDots: true,
        data: [100, 200, 400, 800].map((amount) => ({ amount, score: 10 })),
      });
      expect(categoryAxis(config).type).toBe("category");
      expect(config.data.labels).toEqual(["100", "200", "400", "800"]);
    },
  );
});

describe("standard catalog: data (parity)", () => {
  it("Chart renders pie and line variants with a title", () => {
    const v = renderSurface(standardUI, [
      { id: "root", component: "Column", children: ["p", "l"] },
      {
        id: "p",
        component: "Chart",
        chartType: "donut",
        title: "Share",
        xKey: "name",
        data: [
          { name: "A", value: 1 },
          { name: "B", value: 2 },
        ],
        series: [{ key: "value", label: "Value" }],
        innerRadius: "40%",
        paddingAngle: 2,
      },
      {
        id: "l",
        component: "Chart",
        chartType: "line",
        xKey: "x",
        data: [{ x: 1, y: 2 }],
        series: ["y"],
        stacked: true,
        showDots: true,
      },
    ]);
    expect(byText(v.container, "Share").tagName).toBe("FIGCAPTION");
    const charts = [...v.container.querySelectorAll("[data-a2ui-chart]")];
    expect(
      charts.map((chart) => chart.getAttribute("data-a2ui-chart")),
    ).toEqual(["donut", "line"]);
  });
});
