import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { PNG } from "pngjs";
import { renderJsxToPng } from "./takumi.js";
import { resolveArbitraryElement } from "./detect.js";
import { BarChart } from "../charts/bar-chart.js";
import type { ChannelNode } from "@copilotkit/channels-ui";

const cfg = { fonts: [], stylesheets: [], width: 320, height: 200 };
const data = [
  { label: "a", value: 1 },
  { label: "b", value: 3 },
];

function countPalettePixels(png: Buffer): number {
  const d = PNG.sync.read(png);
  let n = 0;
  for (let i = 0; i < d.data.length; i += 4) {
    const [r, g, b, a] = [
      d.data[i]!,
      d.data[i + 1]!,
      d.data[i + 2]!,
      d.data[i + 3]!,
    ];
    if (a < 128) continue;
    if (
      Math.abs(r - 99) < 40 &&
      Math.abs(g - 102) < 40 &&
      Math.abs(b - 241) < 40
    )
      n++;
  }
  return n;
}

describe("detect: host React elements vs string-typed channel vocab", () => {
  it("a host React element → image", () => {
    expect(
      resolveArbitraryElement(createElement("div", null, "hi")),
    ).toBeTruthy();
  });
  it("a string-typed channel node (<Section> output) → native", () => {
    expect(
      resolveArbitraryElement({ type: "section", props: {} } as ChannelNode),
    ).toBeNull();
  });
});

describe("takumi converter: host React element with a NESTED component node", () => {
  it("materializes the nested chart and rasterizes it", async () => {
    // Shape produced by `<div style=…><BarChart data=…/></div>` under the
    // channels JSX runtime: a React host element whose child is a component
    // ChannelNode (not yet a React element).
    const chartNode = { type: BarChart, props: { data } } as unknown;
    const tree = createElement(
      "div",
      { style: { display: "flex", width: "100%", height: "100%" } },
      chartNode as never,
    );
    const png = await renderJsxToPng(tree, cfg);
    expect([png[0], png[1], png[2], png[3]]).toEqual([0x89, 0x50, 0x4e, 0x47]);
    // The nested chart node was invoked + converted, so its palette color shows.
    expect(countPalettePixels(Buffer.from(png))).toBeGreaterThan(50);
  });
});
