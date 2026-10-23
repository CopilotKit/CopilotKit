import React from "react";
import { render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Chart } from "../Chart";

const data = [
  { name: "First", amount: 0.4 },
  { name: "Second", amount: 0.35 },
  { name: "Third", amount: 0.25 },
];

function sliceLabels(container: HTMLElement) {
  return Array.from(
    container.querySelectorAll(
      "[data-a2ui-chart] svg .recharts-pie-label-text",
    ),
  );
}

function labelLines(container: HTMLElement) {
  return Array.from(
    container.querySelectorAll(
      "[data-a2ui-chart] svg .recharts-pie-label-line",
    ),
  );
}

function categoryLabels(container: HTMLElement) {
  return Array.from(
    container.querySelectorAll(".recharts-yAxis-tick-labels text"),
  );
}

beforeEach(() => {
  // Recharts measures its responsive container; jsdom has no layout engine.
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(
    new DOMRect(0, 0, 320, 240),
  );
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe.each(["donut", "pie"] as const)(
  "Chart %s slice labels",
  (chartType) => {
    const props = {
      chartType,
      data,
      xKey: "name",
      series: ["amount"],
      showLegend: false,
      showTooltip: false,
      showValueLabels: true,
    };

    it("formats fractional values as percentages in the rendered SVG", async () => {
      const { container } = render(<Chart {...props} format="percent" />);

      await waitFor(() => {
        expect(
          sliceLabels(container).map((label) => label.textContent),
        ).toEqual(["40%", "35%", "25%"]);
      });
      expect(labelLines(container)).toHaveLength(3);
    });

    it("uses the requested currency for the rendered slice values", async () => {
      const { container } = render(
        <Chart
          {...props}
          data={data.map((row) => ({ ...row, amount: row.amount * 100 }))}
          format="currency"
          currency="EUR"
        />,
      );

      await waitFor(() => {
        expect(
          sliceLabels(container).map((label) => label.textContent),
        ).toEqual(["€40", "€35", "€25"]);
      });
    });

    it("preserves raw values and label positions when formatting is absent", async () => {
      const { container, rerender } = render(<Chart {...props} />);

      await waitFor(() => {
        expect(
          sliceLabels(container).map((label) => label.textContent),
        ).toEqual(["0.4", "0.35", "0.25"]);
      });
      const positions = () =>
        sliceLabels(container).map((label) => [
          label.getAttribute("x"),
          label.getAttribute("y"),
          label.getAttribute("text-anchor"),
        ]);
      const originalPositions = positions();
      const originalLines = labelLines(container).map((line) =>
        line.getAttribute("d"),
      );

      rerender(<Chart {...props} format="percent" />);

      await waitFor(() => {
        expect(sliceLabels(container)[0]?.textContent).toBe("40%");
      });
      expect(positions()).toEqual(originalPositions);
      expect(
        labelLines(container).map((line) => line.getAttribute("d")),
      ).toEqual(originalLines);
    });

    it.each([false, undefined])(
      "hides labels and leader lines when showValueLabels is %s",
      async (showValueLabels) => {
        const { container } = render(
          <Chart
            {...props}
            format="percent"
            showValueLabels={showValueLabels}
          />,
        );

        await waitFor(() => {
          expect(
            container.querySelectorAll(
              "[data-a2ui-chart] svg .recharts-pie-sector",
            ),
          ).toHaveLength(3);
        });
        expect(sliceLabels(container)).toHaveLength(0);
        expect(labelLines(container)).toHaveLength(0);
      },
    );

    it("can hide leader lines while keeping formatted labels", async () => {
      const { container } = render(
        <Chart {...props} format="percent" showLabelLines={false} />,
      );

      await waitFor(() => {
        expect(
          sliceLabels(container).map((label) => label.textContent),
        ).toEqual(["40%", "35%", "25%"]);
      });
      expect(labelLines(container)).toHaveLength(0);
    });
  },
);

describe("Chart horizontal bar labels", () => {
  const regions = [
    "North",
    "South",
    "East",
    "West",
    "Central",
    "Northern Europe and Scandinavia",
  ];

  it("names every bar on one line and shortens long labels", async () => {
    const { container } = render(
      <Chart
        chartType="bar"
        layout="horizontal"
        data={regions.map((region, index) => ({ region, sales: index + 1 }))}
        xKey="region"
        series={["sales"]}
        yAxis={{ label: "Sales" }}
        showLegend={false}
        showTooltip={false}
      />,
    );

    await waitFor(() => {
      expect(categoryLabels(container)).toHaveLength(regions.length);
    });
    const labels = categoryLabels(container);
    // The full text stays available as a tooltip.
    expect(
      labels.map((label) => label.querySelector("title")?.textContent),
    ).toEqual(regions);
    const shown = labels.map((label) => label.lastChild?.textContent ?? "");
    expect(shown.slice(0, -1)).toEqual(regions.slice(0, -1));
    // The axis widens for the long label, so it keeps "Northern Europe".
    expect(shown.at(-1)).toMatch(/^Northern Europe.*…$/);
    expect(shown.at(-1)!.length).toBeLessThan(regions.at(-1)!.length);

    // The value-axis label sits below its tick labels, not on them.
    const tick = container.querySelector(".recharts-xAxis-tick-labels text");
    const label = container.querySelector(".recharts-label");
    expect(label?.textContent).toBe("Sales");
    expect(
      Number(label?.getAttribute("y")) - Number(tick?.getAttribute("y")),
    ).toBeGreaterThanOrEqual(24);
  });
});
