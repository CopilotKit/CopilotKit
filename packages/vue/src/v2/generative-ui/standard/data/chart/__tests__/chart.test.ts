import { render, waitFor } from "@testing-library/vue";
import { defineComponent, h } from "vue";
import type { App, Plugin } from "vue";
import { describe, expect, it, vi } from "vitest";
import { chartSchema } from "@copilotkit/shared/generative-ui";
import type { ChartProps } from "@copilotkit/shared/generative-ui";
import {
  GenerativeUIChart,
  provideGenerativeUIChart,
} from "../../../../../generative-ui-chart";
import { GENERATIVE_UI_CHART_LOADER } from "../../../loaders";
import type { GenerativeUILibraryLoader } from "../../../loaders";
import { CopilotGenerativeUIChart, chartComponent } from "../index";

/** A chart.js chart as the component sees it: the config, and whether it was destroyed. */
interface DrawnChart {
  config: Record<string, unknown>;
  destroyed: boolean;
}

// jsdom has no canvas, so a stand-in for chart.js records the config of
// each chart. `chart.js/auto`, which the `/chart` plugin imports, is one too.
const { fakeChartLibrary, chartJs } = vi.hoisted(() => {
  function fakeChartLibrary() {
    const instances: DrawnChart[] = [];
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
    return { instances, FakeChart };
  }
  return { fakeChartLibrary, chartJs: fakeChartLibrary() };
});
vi.mock("chart.js/auto", () => ({ Chart: chartJs.FakeChart }));

/** Provides `loader` the way the `/chart` plugin does. */
function withChartLoader(loader: GenerativeUILibraryLoader) {
  return [
    {
      install: (app: App) => app.provide(GENERATIVE_UI_CHART_LOADER, loader),
    },
  ];
}

function renderChart(props: ChartProps, plugins: Plugin[] = []) {
  return render(CopilotGenerativeUIChart, { props, global: { plugins } });
}

/** The text of each row of the table, cells joined by "|". */
function rowTexts(container: Element, selector = "table") {
  const rows = [...container.querySelectorAll(`${selector} tr`)];
  return rows.map((row) =>
    [...row.querySelectorAll("th, td")]
      .map((cell) => cell.textContent?.replace(/\s+/g, " ").trim())
      .join("|"),
  );
}

describe("Chart", () => {
  const chart = {
    title: "Cost",
    xKey: "month",
    format: "currency",
    data: [
      { month: "Jan", cost: 290 },
      { month: "Feb", cost: 580 },
    ],
    series: [{ key: "cost", label: "Monthly cost" }],
  } satisfies ChartProps;

  it("shows the data as a table when chart.js is not provided, next to the hidden table for screen readers", () => {
    const view = renderChart(chart);
    const figure = view.container.querySelector("figure")!;
    expect(figure.querySelector("figcaption")?.textContent).toBe("Cost");
    const area = figure.querySelector('[data-a2ui-chart="bar"]')!;
    expect(area.getAttribute("aria-hidden")).toBe("true");
    expect(rowTexts(view.container, "[data-a2ui-chart] table")).toEqual([
      "month|Monthly cost",
      "Jan|$290",
      "Feb|$580",
    ]);
    const tables = figure.querySelectorAll("table");
    expect(tables).toHaveLength(2);
    expect((tables[1] as HTMLElement).style.position).toBe("absolute");
  });

  it("charts every number field except xKey when series is not set", () => {
    const view = renderChart({
      chartType: "line",
      xKey: "day",
      data: [{ day: "Mon", food: 3, rent: 10, note: "x" }],
    });
    expect(rowTexts(view.container, "[data-a2ui-chart] table")).toEqual([
      "day|food|rent",
      "Mon|3|10",
    ]);
  });

  it("draws with chart.js when a loader is provided, and redraws when the data changes", async () => {
    const { instances, FakeChart } = fakeChartLibrary();
    const view = renderChart(
      chart,
      withChartLoader(() => Promise.resolve({ Chart: FakeChart })),
    );
    await waitFor(() => expect(instances).toHaveLength(1));
    expect(view.container.querySelector("canvas")).not.toBeNull();
    expect(instances[0]!.config).toMatchObject({
      type: "bar",
      data: {
        labels: ["Jan", "Feb"],
        datasets: [{ label: "Monthly cost", data: [290, 580] }],
      },
    });
    // The same content again does not redraw; new data does.
    await view.rerender({ ...chart, data: [...chart.data] });
    expect(instances).toHaveLength(1);
    await view.rerender({ ...chart, data: [{ month: "Mar", cost: 1 }] });
    expect(instances).toHaveLength(2);
    expect(instances[0]!.destroyed).toBe(true);
  });
});

describe("standard catalog: data (parity)", () => {
  it("Chart renders pie and line variants with a title", () => {
    const pie = renderChart({
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
    });
    const line = renderChart({
      chartType: "line",
      xKey: "x",
      data: [{ x: 1, y: 2 }],
      series: ["y"],
      stacked: true,
      showDots: true,
    });
    expect(pie.getByText("Share").tagName).toBe("FIGCAPTION");
    const charts = [pie.container, line.container].map((container) =>
      container.querySelector("[data-a2ui-chart]"),
    );
    expect(
      charts.map((chart) => chart?.getAttribute("data-a2ui-chart")),
    ).toEqual(["donut", "line"]);
  });
});

describe("Chart (Vue-specific semantics)", () => {
  const chart = {
    xKey: "month",
    data: [{ month: "Jan", cost: 290 }],
  } satisfies ChartProps;

  /** The visible table: the fallback inside the chart area. */
  const fallbackTable = (container: Element) =>
    container.querySelector("[data-a2ui-chart] table");

  it("shows a placeholder, not the table, while chart.js loads", () => {
    const view = renderChart(
      chart,
      withChartLoader(() => new Promise(() => {})),
    );
    const area = view.container.querySelector("[data-a2ui-chart]")!;
    expect(area.querySelector("canvas")).toBeNull();
    expect(fallbackTable(view.container)).toBeNull();
    expect(area.children).toHaveLength(1);
    // The screen reader table is there while the chart loads.
    expect(view.container.querySelectorAll("table")).toHaveLength(1);
  });

  it("shows the data as a table when the loader rejects", async () => {
    const view = renderChart(
      chart,
      withChartLoader(() => Promise.reject(new Error("offline"))),
    );
    await waitFor(() => expect(fallbackTable(view.container)).not.toBeNull());
    expect(rowTexts(view.container, "[data-a2ui-chart] table")).toEqual([
      "month|cost",
      "Jan|290",
    ]);
  });

  it("shows the data as a table when chart.js throws while drawing", async () => {
    class BrokenChart {
      constructor() {
        throw new Error("no canvas context");
      }
      destroy() {}
    }
    const view = renderChart(
      chart,
      withChartLoader(() => Promise.resolve({ Chart: BrokenChart })),
    );
    await waitFor(() => expect(fallbackTable(view.container)).not.toBeNull());
    expect(view.container.querySelector("canvas")).toBeNull();
  });

  it("keeps the legend, grid and tooltip when their boolean props are not set", async () => {
    const { instances, FakeChart } = fakeChartLibrary();
    renderChart(
      chart,
      withChartLoader(() => Promise.resolve({ Chart: FakeChart })),
    );
    await waitFor(() => expect(instances).toHaveLength(1));
    expect(instances[0]!.config).toMatchObject({
      options: {
        plugins: { legend: { display: true }, tooltip: { enabled: true } },
        scales: { y: { grid: { display: true } } },
      },
    });
  });

  it("destroys the chart on unmount", async () => {
    const { instances, FakeChart } = fakeChartLibrary();
    const view = renderChart(
      chart,
      withChartLoader(() => Promise.resolve({ default: FakeChart })),
    );
    await waitFor(() => expect(instances).toHaveLength(1));
    expect(instances[0]!.destroyed).toBe(false);
    view.unmount();
    expect(instances[0]!.destroyed).toBe(true);
  });

  it("draws with chart.js/auto through the GenerativeUIChart plugin", async () => {
    const before = chartJs.instances.length;
    const view = renderChart(chart, [GenerativeUIChart]);
    await waitFor(() => expect(chartJs.instances).toHaveLength(before + 1));
    expect(view.container.querySelector("canvas")).not.toBeNull();
    expect(chartJs.instances[before]!.config).toMatchObject({
      data: { labels: ["Jan"] },
    });
  });

  it("draws with chart.js/auto below a component that calls provideGenerativeUIChart", async () => {
    const before = chartJs.instances.length;
    const Page = defineComponent({
      setup() {
        provideGenerativeUIChart();
        return () => h(CopilotGenerativeUIChart, chart);
      },
    });
    const view = render(Page);
    await waitFor(() => expect(chartJs.instances).toHaveLength(before + 1));
    expect(view.container.querySelector("canvas")).not.toBeNull();
  });

  it("defines Chart with the shared declaration and the Vue component", () => {
    expect(chartComponent.Chart.component).toBe(CopilotGenerativeUIChart);
    expect(chartComponent.Chart.props).toBe(chartSchema);
  });
});
