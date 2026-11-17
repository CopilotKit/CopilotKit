import { describe, expect, it } from "vitest";
import { h } from "vue";
import { mount } from "@vue/test-utils";
import { CopilotIcon, IconCircle, IconPlay, IconX } from "../index";

describe("CopilotIcon", () => {
  it("draws the named icon with Lucide's classes and default attributes", () => {
    const svg = mount(CopilotIcon, { props: { name: "X" } }).find("svg");

    expect(svg.classes()).toEqual(["lucide", "lucide-x"]);
    expect(svg.attributes()).toMatchObject({
      xmlns: "http://www.w3.org/2000/svg",
      width: "24",
      height: "24",
      viewBox: "0 0 24 24",
      fill: "none",
      stroke: "currentColor",
      "stroke-width": "2",
      "stroke-linecap": "round",
      "stroke-linejoin": "round",
    });
    expect(svg.findAll("path").map((path) => path.attributes("d"))).toEqual([
      "M18 6 6 18",
      "m6 6 12 12",
    ]);
  });

  it("draws circle and polygon nodes", () => {
    const circle = mount(IconCircle).find("svg").find("circle");
    const polygon = mount(IconPlay).find("svg").find("polygon");

    expect(circle.attributes()).toMatchObject({ cx: "12", cy: "12", r: "10" });
    expect(polygon.attributes("points")).toBe("6 3 20 12 6 21 6 3");
  });

  it("applies size, color and stroke-width", () => {
    const svg = mount(IconX, {
      props: { size: 18, color: "red", strokeWidth: 1.75 },
    }).find("svg");

    expect(svg.attributes()).toMatchObject({
      width: "18",
      height: "18",
      stroke: "red",
      "stroke-width": "1.75",
    });
  });

  it("passes other attributes to the svg after the Lucide classes", () => {
    const svg = mount(IconX, {
      attrs: {
        class: "icon-class",
        fill: "currentColor",
        "data-testid": "close-icon",
        style: "color: rgb(255, 0, 0);",
      },
    }).find("svg");

    expect(svg.classes()).toEqual(["lucide", "lucide-x", "icon-class"]);
    expect(svg.attributes("fill")).toBe("currentColor");
    expect(svg.attributes("data-testid")).toBe("close-icon");
    expect(svg.attributes("style")).toContain("color: rgb(255, 0, 0)");
  });

  it("hides an unnamed icon from screen readers", () => {
    const svg = mount(IconX).find("svg");

    expect(svg.attributes("aria-hidden")).toBe("true");
  });

  it("keeps a named icon visible to screen readers", () => {
    const labelled = mount(IconX, { attrs: { "aria-label": "Close" } }).find(
      "svg",
    );
    const withRole = mount(IconX, { attrs: { role: "img" } }).find("svg");

    expect(labelled.attributes("aria-hidden")).toBeUndefined();
    expect(labelled.attributes("aria-label")).toBe("Close");
    expect(withRole.attributes("aria-hidden")).toBeUndefined();
  });

  it("keeps an icon with slot content visible to screen readers", () => {
    const svg = mount(IconX, {
      slots: { default: () => h("title", "Close") },
    }).find("svg");

    expect(svg.attributes("aria-hidden")).toBeUndefined();
    expect(svg.find("title").text()).toBe("Close");
  });
});
