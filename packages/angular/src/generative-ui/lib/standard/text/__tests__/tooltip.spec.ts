import { describe, expect, it } from "vitest";
import { renderSurface } from "../../../__tests__/render";
import { standardUI } from "../../index";
import { byText, ui } from "./helpers";

describe("standard text", () => {
  it("shows the Tooltip content on focus and on hover, and hides it on Escape", () => {
    const view = renderSurface(ui, [
      { id: "root", component: "Tooltip", trigger: "t", content: "c" },
      { id: "t", component: "Badge", label: "Beta" },
      { id: "c", component: "Text", text: "Not stable yet" },
    ]);
    const trigger = view.container.querySelector<HTMLElement>(
      "[data-a2ui-tooltip-trigger]",
    )!;
    expect(trigger.textContent?.trim()).toBe("Beta");
    const tooltip =
      view.container.querySelector<HTMLElement>("[role=tooltip]")!;
    expect(tooltip.textContent?.trim()).toBe("Not stable yet");
    expect(trigger.getAttribute("aria-describedby")).toBe(tooltip.id);
    expect(tooltip.hidden).toBe(true);

    view.act(() => trigger.dispatchEvent(new FocusEvent("focus")));
    expect(tooltip.hidden).toBe(false);
    view.act(() =>
      trigger.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })),
    );
    expect(tooltip.hidden).toBe(true);

    const wrapper = trigger.parentElement!;
    view.act(() => wrapper.dispatchEvent(new MouseEvent("mouseenter")));
    expect(tooltip.hidden).toBe(false);
    view.act(() => wrapper.dispatchEvent(new MouseEvent("mouseleave")));
    expect(tooltip.hidden).toBe(true);
  });
});

describe("standard catalog: tooltip (parity)", () => {
  it("Tooltip hugs its trigger instead of stretching across the column", () => {
    const v = renderSurface(standardUI, [
      { id: "root", component: "Column", children: ["tip"] },
      { id: "tip", component: "Tooltip", trigger: "t", content: "c" },
      { id: "t", component: "Text", text: "Hover me" },
      { id: "c", component: "Text", text: "Tip" },
    ]);
    const wrapper = byText(v.container, "Hover me").closest(
      "[data-a2ui-tooltip-trigger]",
    )!.parentElement as HTMLElement;
    expect(wrapper.style.alignSelf).toBe("flex-start");
    expect(wrapper.style.width).toBe("max-content");
  });
});
