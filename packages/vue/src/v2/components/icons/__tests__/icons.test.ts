import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import {
  IconArrowUp,
  IconCheck,
  IconCheckCircle,
  IconChevronDown,
  IconChevronLeft,
  IconChevronRight,
  IconCircle,
  IconCopy,
  IconEdit,
  IconLoader2,
  IconMessageCircle,
  IconMic,
  IconPlus,
  IconRefreshCw,
  IconSquare,
  IconThumbsDown,
  IconThumbsUp,
  IconVolume2,
  IconX,
} from "../index";

describe("icons adapter", () => {
  it("exports all expected icon aliases", () => {
    const icons = [
      IconMessageCircle,
      IconX,
      IconChevronDown,
      IconPlus,
      IconMic,
      IconArrowUp,
      IconCheck,
      IconSquare,
      IconLoader2,
      IconCopy,
      IconEdit,
      IconChevronLeft,
      IconChevronRight,
      IconThumbsUp,
      IconThumbsDown,
      IconVolume2,
      IconRefreshCw,
      IconCheckCircle,
      IconCircle,
    ];

    for (const icon of icons) {
      expect(icon).toBeDefined();
    }
  });

  it("renders svg icons from aliases", () => {
    const xWrapper = mount(IconX);
    const loaderWrapper = mount(IconLoader2);

    expect(xWrapper.find("svg").exists()).toBe(true);
    expect(loaderWrapper.find("svg").exists()).toBe(true);
  });

  it("passes through classes, size, style, and accessibility attributes", () => {
    const wrapper = mount(IconX, {
      attrs: {
        class: "icon-class",
        width: "18",
        height: "20",
        "stroke-width": "1.5",
        role: "img",
        "aria-hidden": "true",
        style: "color: rgb(255, 0, 0);",
      },
    });

    const svg = wrapper.find("svg");

    expect(svg.exists()).toBe(true);
    expect(svg.classes()).toContain("icon-class");
    expect(svg.attributes("width")).toBe("18");
    expect(svg.attributes("height")).toBe("20");
    expect(svg.attributes("stroke-width")).toBe("1.5");
    expect(svg.attributes("role")).toBe("img");
    expect(svg.attributes("aria-hidden")).toBe("true");
    expect(svg.attributes("style")).toContain("color");
  });
});
