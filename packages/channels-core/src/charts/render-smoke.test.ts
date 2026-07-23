import { describe, it, expect } from "vitest";
import { PNG } from "pngjs";
import { renderJsxToPng } from "../render/takumi.js";
import { BarChart } from "./bar-chart.js";
import { StackedBar } from "./stacked-bar.js";
import { Sparkline } from "./sparkline.js";
import { Meter } from "./meter.js";
import { LineChart } from "./line-chart.js";
import { PieChart } from "./pie-chart.js";
import { Scatter } from "./scatter.js";

const cfg = { fonts: [], stylesheets: [], width: 320, height: 200 };
const data = [
  { label: "a", value: 1 },
  { label: "b", value: 3 },
  { label: "c", value: 2 },
];

/**
 * Counts pixels that are neither near-white nor near-black — i.e. an
 * actual palette color rendered visibly, not just a blank/invisible chart
 * (which is what an unresolved CSS `var()` stroke/fill would produce).
 */
function countColoredPixels(png: Buffer): number {
  const decoded = PNG.sync.read(png);
  let count = 0;
  for (let i = 0; i < decoded.data.length; i += 4) {
    const r = decoded.data[i] ?? 0;
    const g = decoded.data[i + 1] ?? 0;
    const b = decoded.data[i + 2] ?? 0;
    const nearWhite = r > 245 && g > 245 && b > 245;
    const nearBlack = r < 40 && g < 40 && b < 40;
    if (!nearWhite && !nearBlack) {
      count++;
    }
  }
  return count;
}

describe("chart render smoke (Takumi)", () => {
  it("renders a bar chart to a non-empty PNG", async () => {
    const png = await renderJsxToPng(BarChart({ data }), cfg);
    expect(png.byteLength).toBeGreaterThan(100);
    expect([png[0], png[1], png[2], png[3]]).toEqual([0x89, 0x50, 0x4e, 0x47]); // PNG signature
  });
  it("renders a line chart to a PNG with visible palette colors", async () => {
    const png = await renderJsxToPng(LineChart({ data }), cfg);
    expect(png[0]).toBe(0x89);
    const colored = countColoredPixels(Buffer.from(png));
    expect(colored).toBeGreaterThan(50);
  });
  it("renders a pie chart to a PNG with visible palette colors", async () => {
    const png = await renderJsxToPng(
      PieChart({ data, width: 200, height: 200 }),
      cfg,
    );
    expect(png[0]).toBe(0x89);
    const colored = countColoredPixels(Buffer.from(png));
    expect(colored).toBeGreaterThan(50);
  });
  it("renders a stacked bar chart to a PNG with visible palette colors", async () => {
    const png = await renderJsxToPng(
      StackedBar({
        data: [
          { label: "a", values: [1, 2] },
          { label: "b", values: [3, 1] },
        ],
      }),
      cfg,
    );
    expect(png[0]).toBe(0x89);
    const colored = countColoredPixels(Buffer.from(png));
    expect(colored).toBeGreaterThan(50);
  });
  it("renders a sparkline to a PNG with visible palette colors", async () => {
    const png = await renderJsxToPng(
      Sparkline({ data: [1, 3, 2, 4, 1], width: 200, height: 60 }),
      cfg,
    );
    expect(png[0]).toBe(0x89);
    const colored = countColoredPixels(Buffer.from(png));
    expect(colored).toBeGreaterThan(50);
  });
  it("renders a meter to a PNG with visible palette colors", async () => {
    const png = await renderJsxToPng(Meter({ value: 0.6 }), cfg);
    expect(png[0]).toBe(0x89);
    const colored = countColoredPixels(Buffer.from(png));
    expect(colored).toBeGreaterThan(50);
  });
  it("renders a scatter plot to a PNG with visible palette colors", async () => {
    const png = await renderJsxToPng(
      Scatter({
        points: [
          { x: 1, y: 2 },
          { x: 3, y: 1 },
          { x: 2, y: 4 },
        ],
        width: 200,
        height: 200,
      }),
      cfg,
    );
    expect(png[0]).toBe(0x89);
    const colored = countColoredPixels(Buffer.from(png));
    expect(colored).toBeGreaterThan(50);
  });
});
