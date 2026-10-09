import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { PNG } from "pngjs";
import { renderJsxToPng } from "./takumi.js";
import { resolveArbitraryElement } from "./detect.js";
import { defaultAllowImageUrl } from "./url-policy.js";
import { renderToIR } from "@copilotkit/channels-ui";
import type { ChannelNode } from "@copilotkit/channels-ui";

const cfg = {
  fonts: [],
  stylesheets: [],
  allowImageUrl: () => false,
  width: 320,
  height: 200,
};

function ColorBox() {
  return createElement("div", {
    style: {
      width: "100%",
      height: "100%",
      backgroundColor: "rgb(90, 60, 209)",
    },
  });
}

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
      Math.abs(r - 90) < 40 &&
      Math.abs(g - 60) < 40 &&
      Math.abs(b - 209) < 40
    )
      n++;
  }
  return n;
}

describe("detect: host React elements vs string-typed channel vocab", () => {
  it("a host React element → image", () => {
    expect(
      resolveArbitraryElement(
        renderToIR(createElement("div", null, "hi") as never),
      ),
    ).toBeTruthy();
  });
  it("a string-typed channel node (<Section> output) → native", () => {
    expect(
      resolveArbitraryElement([{ type: "section", props: {} } as ChannelNode]),
    ).toBeNull();
  });
});

describe("takumi converter: host React element with a NESTED component node", () => {
  it("materializes the nested component and rasterizes it", async () => {
    // Shape produced by `<div style=…><ColorBox/></div>` under the
    // channels JSX runtime: a React host element whose child is a component
    // ChannelNode (not yet a React element).
    const childNode = { type: ColorBox, props: {} } as unknown;
    const tree = createElement(
      "div",
      { style: { display: "flex", width: "100%", height: "100%" } },
      childNode as never,
    );
    const png = await renderJsxToPng(tree, cfg);
    expect([png[0], png[1], png[2], png[3]]).toEqual([0x89, 0x50, 0x4e, 0x47]);
    expect(countPalettePixels(Buffer.from(png))).toBeGreaterThan(50);
  });
});

describe("renderer remote image gate", () => {
  it("does not fetch a mapped private IPv6 image", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    try {
      const url = "http://[::ffff:127.0.0.1]/image.png";
      expect(defaultAllowImageUrl(url)).toBe(false);
      try {
        await renderJsxToPng(
          createElement("img", { src: url, width: 1, height: 1 }),
          {
            ...cfg,
            allowImageUrl: defaultAllowImageUrl,
          },
        );
      } catch {
        // Takumi may reject a denied image; the fetch boundary is the assertion.
      }
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
