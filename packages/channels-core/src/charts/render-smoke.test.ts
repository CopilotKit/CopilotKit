import { describe, it, expect } from "vitest";
import { renderJsxToPng } from "../render/takumi.js";
import { BarChart } from "./bar-chart.js";
import { LineChart } from "./line-chart.js";
import { PieChart } from "./pie-chart.js";

const cfg = { fonts: [], stylesheets: [], width: 320, height: 200 };
const data = [
  { label: "a", value: 1 },
  { label: "b", value: 3 },
  { label: "c", value: 2 },
];

describe("chart render smoke (Takumi)", () => {
  it("renders a bar chart to a non-empty PNG", async () => {
    const png = await renderJsxToPng(BarChart({ data }), cfg);
    expect(png.byteLength).toBeGreaterThan(100);
    expect([png[0], png[1], png[2], png[3]]).toEqual([0x89, 0x50, 0x4e, 0x47]); // PNG signature
  });
  it("renders a line chart to a PNG", async () => {
    const png = await renderJsxToPng(LineChart({ data }), cfg);
    expect(png[0]).toBe(0x89);
  });
  it("renders a pie chart to a PNG", async () => {
    const png = await renderJsxToPng(
      PieChart({ data, width: 200, height: 200 }),
      cfg,
    );
    expect(png[0]).toBe(0x89);
  });
});
