import { describe, expect, it, vi } from "vitest";
import { provideFakeIcons, renderInColumn } from "./helpers";

describe("Icon", () => {
  it("loads a lucide Icon on first use and hides it from screen readers", async () => {
    provideFakeIcons();
    const view = renderInColumn({
      id: "i",
      component: "Icon",
      name: "arrow-right",
    });
    await vi.waitFor(() => {
      view.detectChanges();
      expect(
        view.container.querySelector("svg.lucide-arrow-right"),
      ).not.toBeNull();
    });
    const icon = view.container.querySelector("svg.lucide-arrow-right")!;
    expect(icon.getAttribute("aria-hidden")).toBe("true");
    expect(icon.getAttribute("width")).toBe("20");
    expect(icon.getAttribute("stroke")).toBe("currentColor");
    expect(icon.querySelectorAll("path")).toHaveLength(2);
    expect(icon.querySelector("path")?.namespaceURI).toBe(
      "http://www.w3.org/2000/svg",
    );
  });

  it("names an Icon with a label for screen readers", async () => {
    provideFakeIcons();
    // "arrowForward" is an A2UI name, mapped to the lucide arrow.
    const view = renderInColumn({
      id: "l",
      component: "Icon",
      name: "arrowForward",
      label: "Next",
      size: "lg",
    });
    await vi.waitFor(() => {
      view.detectChanges();
      expect(
        view.container.querySelector("svg.lucide-arrow-right"),
      ).not.toBeNull();
    });
    const named = view.container.querySelector("svg.lucide-arrow-right")!;
    expect(named.getAttribute("role")).toBe("img");
    expect(named.getAttribute("aria-label")).toBe("Next");
    expect(named.getAttribute("aria-hidden")).toBeNull();
    expect(named.getAttribute("width")).toBe("24");
  });

  it("names an Icon and an Svg by the envelope label, like the label prop", async () => {
    provideFakeIcons();
    const view = renderInColumn(
      {
        id: "i",
        component: "Icon",
        name: "check",
        accessibility: { label: "Done", description: "The step is complete" },
      },
      {
        id: "s",
        component: "Svg",
        viewBox: "0 0 10 10",
        circles: [{ cx: 5, cy: 5, r: 4 }],
        accessibility: { label: "Dot" },
      },
    );
    await vi.waitFor(() => {
      view.detectChanges();
      expect(view.container.querySelector("svg.lucide-check")).not.toBeNull();
    });
    const icon = view.container.querySelector("svg.lucide-check")!;
    expect(icon.getAttribute("role")).toBe("img");
    expect(icon.getAttribute("aria-label")).toBe("Done");
    expect(icon.getAttribute("aria-description")).toBe("The step is complete");
    const dot = view.container.querySelector('svg[aria-label="Dot"]')!;
    expect(dot.getAttribute("role")).toBe("img");
    expect(dot.querySelector("circle")).not.toBeNull();
  });

  it("renders nothing for an Icon with an unknown name", async () => {
    provideFakeIcons();
    const view = renderInColumn(
      { id: "c", component: "Icon", name: "definitely-not-an-icon" },
      { id: "k", component: "Icon", name: "check" },
    );
    // The known icon shows that the icon set has loaded.
    await vi.waitFor(() => {
      view.detectChanges();
      expect(view.container.querySelector("svg.lucide-check")).not.toBeNull();
    });
    expect(view.container.querySelectorAll("svg:not([hidden])")).toHaveLength(
      1,
    );
  });

  it("draws an svgPath icon with a fill, named by the envelope label", () => {
    const view = renderInColumn({
      id: "p",
      component: "Icon",
      name: { svgPath: "M0 0h24v24H0z" },
      color: "danger",
      accessibility: { label: "Alert" },
    });
    const icon = view.container.querySelector("svg[copilotGenerativeUIIcon]")!;
    expect(icon.getAttribute("aria-label")).toBe("Alert");
    expect(icon.getAttribute("fill")).toBe(
      "var(--a2ui-color-text-danger, #c1322c)",
    );
    expect(icon.querySelector("path")?.getAttribute("d")).toBe("M0 0h24v24H0z");
  });
});

describe("Svg", () => {
  it("draws an Svg from shapes with token colors and pixel sizes", () => {
    const view = renderInColumn({
      id: "s",
      component: "Svg",
      viewBox: "0 0 10 10",
      width: 240,
      height: 80,
      strokeLinecap: "round",
      strokeLinejoin: "round",
      preserveAspectRatio: "none",
      paths: [{ d: "M0 0L10 10", stroke: "danger" }],
      circles: [{ cx: 5, cy: 5, r: 4 }],
      texts: [{ x: 1, y: 9, text: "hi" }],
    });
    const svg = view.container.querySelector("svg")!;
    expect(svg.getAttribute("width")).toBe("240");
    expect(svg.getAttribute("height")).toBe("80");
    expect(svg.getAttribute("stroke-linecap")).toBe("round");
    expect(svg.getAttribute("stroke-linejoin")).toBe("round");
    expect(svg.getAttribute("preserveAspectRatio")).toBe("none");
    expect(svg.getAttribute("aria-hidden")).toBe("true");
    const path = svg.querySelector("path[d='M0 0L10 10']")!;
    expect(path.getAttribute("stroke")).toBe(
      "var(--a2ui-color-text-danger, #c1322c)",
    );
    expect(svg.querySelectorAll("circle")).toHaveLength(1);
    expect(svg.querySelector("text")!.textContent?.trim()).toBe("hi");
  });

  it("names an Svg with a label for screen readers", () => {
    const view = renderInColumn({
      id: "s",
      component: "Svg",
      label: "Floor plan",
      rects: [{ x: 0, y: 0, width: 4, height: 4 }],
    });
    const svg = view.container.querySelector("svg")!;
    expect(svg.getAttribute("role")).toBe("img");
    expect(svg.getAttribute("aria-label")).toBe("Floor plan");
    expect(svg.querySelector("rect")).toBeInstanceOf(SVGElement);
  });
});
