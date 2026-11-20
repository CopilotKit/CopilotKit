import React from "react";
import { render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Chart } from "../Chart";
import type { ChartProps } from "../Chart";

// Only supply the browser measurement missing from jsdom. Recharts computes
// the axes and SVG marks itself; no chart component or scale is mocked.
beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
    x: 0,
    y: 0,
    top: 0,
    left: 0,
    right: 600,
    bottom: 300,
    width: 600,
    height: 300,
    toJSON: () => ({}),
  });
});

afterEach(() => vi.restoreAllMocks());

async function renderChart(props: ChartProps) {
  const view = render(
    <Chart height={300} showLegend={false} showTooltip={false} {...props} />,
  );
  await waitFor(() => {
    expect(view.container.querySelector(".recharts-surface")).not.toBeNull();
  });
  return view;
}

function scatterPoints(container: HTMLElement) {
  return Array.from(
    container.querySelectorAll(".recharts-scatter-symbol .recharts-symbols"),
    (mark) => {
      const transform = mark.getAttribute("transform");
      const match = transform?.match(/translate\(([^,]+),\s*([^)]+)\)/);
      expect(match, `Scatter point transform: ${transform}`).not.toBeNull();
      return { x: Number(match![1]), y: Number(match![2]) };
    },
  );
}

function expectGapRatios(coordinates: number[], ratios: number[]) {
  expect(coordinates).toHaveLength(ratios.length + 1);
  const firstGap = coordinates[1] - coordinates[0];
  expect(Math.abs(firstGap)).toBeGreaterThan(0);
  ratios.forEach((ratio, index) => {
    expect(
      (coordinates[index + 1] - coordinates[index]) / firstGap,
    ).toBeCloseTo(ratio, 5);
  });
}

describe("Chart scatter spacing", () => {
  it.each(["vertical", "horizontal"] as const)(
    "spaces numeric xKey values continuously in %s layout",
    async (layout) => {
      const view = await renderChart({
        chartType: "scatter",
        layout,
        xKey: "amount",
        data: [100, 200, 400, 800].map((amount) => ({ amount, score: 10 })),
      });
      const points = scatterPoints(view.container);
      expectGapRatios(
        points.map((point) => (layout === "horizontal" ? point.y : point.x)),
        [1, 2, 4],
      );
    },
  );

  it.each(["vertical", "horizontal"] as const)(
    "positions unsorted data for multiple series and preserves the value axis in %s layout",
    async (layout) => {
      const data = [400, 100, 800, 200].map((amount) => ({
        amount,
        first: amount / 1000,
        second: amount / 2000,
        ignored: amount * 2,
      }));
      const view = await renderChart({
        chartType: "scatter",
        layout,
        xKey: "amount",
        data,
        series: ["first", { key: "second", label: "Second series" }],
        yAxis: { min: 0, max: 1, width: 72, label: "Share" },
        format: "percent",
      });
      const points = scatterPoints(view.container);
      expect(points).toHaveLength(8);
      for (const [index, key] of (["first", "second"] as const).entries()) {
        const seriesPoints = points.slice(index * 4, (index + 1) * 4);
        // Read SVG marks in data order, then compare by their input x value.
        const ordered = data
          .map((row, rowIndex) => ({ row, point: seriesPoints[rowIndex] }))
          .sort((a, b) => a.row.amount - b.row.amount);
        expectGapRatios(
          ordered.map(({ point }) =>
            layout === "horizontal" ? point.y : point.x,
          ),
          [1, 2, 4],
        );
        ordered.forEach(({ row, point }) => {
          const value = row[key];
          if (layout === "horizontal") {
            expect(point.x).toBeCloseTo(72 + value * (600 - 72 - 8), 5);
          } else {
            expect(point.y).toBeCloseTo(270 - value * (270 - 8), 5);
          }
        });
      }
      const valueAxis = view.container.querySelector(
        layout === "horizontal"
          ? ".recharts-xAxis-tick-labels"
          : ".recharts-yAxis-tick-labels",
      );
      expect(valueAxis?.textContent).toContain("100%");
      expect(view.container.querySelector(".recharts-label")?.textContent).toBe(
        "Share",
      );
    },
  );

  it.each(["vertical", "horizontal"] as const)(
    "keeps string xKey values categorical in %s layout",
    async (layout) => {
      const view = await renderChart({
        chartType: "scatter",
        layout,
        xKey: "category",
        data: ["100", "200", "400", "800"].map((category) => ({
          category,
          score: 10,
        })),
      });
      expectGapRatios(
        scatterPoints(view.container).map((point) =>
          layout === "horizontal" ? point.y : point.x,
        ),
        [1, 1, 1],
      );
    },
  );

  it("keeps mixed numeric and string scatter values categorical", async () => {
    const view = await renderChart({
      chartType: "scatter",
      xKey: "amount",
      data: [100, "200", 400, 800].map((amount) => ({ amount, score: 10 })),
    });
    expectGapRatios(
      scatterPoints(view.container).map((point) => point.x),
      [1, 1, 1],
    );
  });

  it.each(["bar", "line"] as const)(
    "keeps numeric xKey values categorical for %s charts",
    async (chartType) => {
      const view = await renderChart({
        chartType,
        xKey: "amount",
        showDots: true,
        data: [100, 200, 400, 800].map((amount) => ({ amount, score: 10 })),
      });
      const marks = view.container.querySelectorAll(
        chartType === "bar"
          ? ".recharts-bar-rectangle path"
          : ".recharts-line-dot",
      );
      const centers = Array.from(marks, (mark) =>
        chartType === "bar"
          ? Number(mark.getAttribute("x")) +
            Number(mark.getAttribute("width")) / 2
          : Number(mark.getAttribute("cx")),
      );
      expectGapRatios(centers, [1, 1, 1]);
    },
  );
});
