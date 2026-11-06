import React, { createRef } from "react";
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { CopilotIcon } from "../CopilotIcon";

function svgOf(icon: React.ReactElement) {
  const { container } = render(icon);
  const svg = container.querySelector("svg");
  if (!svg) throw new Error("CopilotIcon rendered no <svg>");
  return svg;
}

/** Each child element as `[tag, { attribute: value }]`. */
function childrenOf(svg: SVGSVGElement) {
  return Array.from(svg.children).map((child) => [
    child.tagName,
    Object.fromEntries(
      Array.from(child.attributes).map((attribute) => [
        attribute.name,
        attribute.value,
      ]),
    ),
  ]);
}

describe("CopilotIcon", () => {
  it("draws the icon with Lucide's attributes and class names", () => {
    const svg = svgOf(<CopilotIcon name="ArrowUp" className="my-icon" />);

    expect(svg.getAttribute("class")).toBe("lucide lucide-arrow-up my-icon");
    expect(svg.getAttribute("viewBox")).toBe("0 0 24 24");
    expect(svg.getAttribute("width")).toBe("24");
    expect(svg.getAttribute("height")).toBe("24");
    expect(svg.getAttribute("fill")).toBe("none");
    expect(svg.getAttribute("stroke")).toBe("currentColor");
    expect(svg.getAttribute("stroke-width")).toBe("2");
    expect(svg.getAttribute("stroke-linecap")).toBe("round");
    expect(svg.getAttribute("stroke-linejoin")).toBe("round");
    expect(childrenOf(svg)).toEqual([
      ["path", { d: "m5 12 7-7 7 7" }],
      ["path", { d: "M12 19V5" }],
    ]);
  });

  it("draws circle, polygon and rect elements", () => {
    expect(childrenOf(svgOf(<CopilotIcon name="Circle" />))).toEqual([
      ["circle", { cx: "12", cy: "12", r: "10" }],
    ]);
    expect(childrenOf(svgOf(<CopilotIcon name="Play" />))).toEqual([
      ["polygon", { points: "6 3 20 12 6 21 6 3" }],
    ]);
    expect(childrenOf(svgOf(<CopilotIcon name="Square" />))).toEqual([
      ["rect", { width: "18", height: "18", x: "3", y: "3", rx: "2" }],
    ]);
  });

  it("uses the size, stroke width, color and other SVG props it is given", () => {
    const svg = svgOf(
      <CopilotIcon
        name="MessageCircle"
        size={16}
        strokeWidth={1.75}
        color="red"
        fill="currentColor"
        data-testid="icon"
      />,
    );

    expect(svg.getAttribute("class")).toBe("lucide lucide-message-circle");
    expect(svg.getAttribute("width")).toBe("16");
    expect(svg.getAttribute("height")).toBe("16");
    expect(svg.getAttribute("stroke-width")).toBe("1.75");
    expect(svg.getAttribute("stroke")).toBe("red");
    expect(svg.getAttribute("fill")).toBe("currentColor");
    expect(svg.getAttribute("data-testid")).toBe("icon");
  });

  it("is hidden from screen readers by default", () => {
    expect(svgOf(<CopilotIcon name="X" />).getAttribute("aria-hidden")).toBe(
      "true",
    );
  });

  it("is exposed with its name when given an aria-label", () => {
    const svg = svgOf(<CopilotIcon name="X" role="img" aria-label="Close" />);

    expect(svg.getAttribute("aria-hidden")).toBeNull();
    expect(svg.getAttribute("aria-label")).toBe("Close");
  });

  it("forwards its ref to the <svg>", () => {
    const ref = createRef<SVGSVGElement>();
    render(<CopilotIcon name="Check" ref={ref} />);

    expect(ref.current?.getAttribute("class")).toBe("lucide lucide-check");
  });
});
