import { describe, expect, it } from "vitest";
import { renderDiscordChartSvg } from "./chart.js";

describe("renderDiscordChartSvg", () => {
  it("preserves chart titles, axis titles, labels, and values in the image", () => {
    const svg = renderDiscordChartSvg({
      type: "line",
      title: "Latency <p95>",
      xAxisTitle: "Release & day",
      yAxisTitle: "Milliseconds",
      data: [
        { label: "Monday", value: 120 },
        { label: "Tuesday", value: 95 },
      ],
    });

    expect(svg).toContain("Latency &lt;p95&gt;");
    expect(svg).toContain("Release &amp; day");
    expect(svg).toContain("Milliseconds");
    expect(svg).toContain("Monday");
    expect(svg).toContain(">120<");
    expect(svg).toContain("Tuesday");
    expect(svg).toContain(">95<");
  });
});
