import { afterEach, describe, expect, it, vi } from "vitest";
import { renderSurface, updateComponents } from "../../../__tests__/render";
import { byText, click, press, query } from "../../../__tests__/dom";
import { standardUI } from "../../index";
import { popoverNodes, text, ui } from "./helpers";

afterEach(() => {
  vi.useRealTimers();
  document.querySelector(".cdk-overlay-container")?.remove();
});

describe("Popover", () => {
  it("opens a dialog named by its trigger, and closes on a second click", () => {
    const view = renderSurface(ui, popoverNodes());
    const trigger = view.container.querySelector<HTMLButtonElement>(
      "[data-a2ui-popover-trigger]",
    )!;
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    view.act(() => trigger.click());
    const content = view.container.querySelector("[role=dialog]")!;
    expect(text(content)).toBe("Hiddencontent");
    expect(content.getAttribute("aria-labelledby")).toBe(trigger.id);
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    expect(trigger.getAttribute("aria-controls")).toBe(content.id);
    view.act(() => trigger.click());
    expect(view.container.querySelector("[role=dialog]")).toBeNull();
    expect(view.container.textContent).not.toContain("Hidden content");
  });

  it("closes on Escape and moves focus back to the trigger", () => {
    const view = renderSurface(ui, popoverNodes({ open: true }));
    const content = view.container.querySelector<HTMLElement>("[role=dialog]")!;
    const trigger = view.container.querySelector<HTMLButtonElement>(
      "[data-a2ui-popover-trigger]",
    )!;
    view.act(() => press(content, "Escape"));
    expect(view.container.querySelector("[role=dialog]")).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it("closes on a pointer press outside of it", () => {
    const view = renderSurface(ui, popoverNodes());
    const trigger = view.container.querySelector<HTMLButtonElement>(
      "[data-a2ui-popover-trigger]",
    )!;
    view.act(() => trigger.click());
    const content = view.container.querySelector<HTMLElement>("[role=dialog]")!;
    view.act(() =>
      content.dispatchEvent(new Event("pointerdown", { bubbles: true })),
    );
    expect(view.container.querySelector("[role=dialog]")).not.toBeNull();
    const outside = [...view.container.querySelectorAll("span")].find(
      (el) => el.textContent?.trim() === "Outside",
    )!;
    view.act(() =>
      outside.dispatchEvent(new Event("pointerdown", { bubbles: true })),
    );
    expect(view.container.querySelector("[role=dialog]")).toBeNull();
  });

  it("writes the open state to a bound data path", () => {
    const view = renderSurface(
      ui,
      popoverNodes({ open: { "@path": "/menuOpen" } }),
      { menuOpen: false },
    );
    view.act(() =>
      view.container
        .querySelector<HTMLElement>("[data-a2ui-popover-trigger]")!
        .click(),
    );
    expect(view.container.querySelector("[role=dialog]")).not.toBeNull();
    expect(view.dataAt("/menuOpen")).toBe(true);
  });

  it("Popover with showOnHover and hoverOpenDelay opens after the delay", () => {
    vi.useFakeTimers();
    const view = renderSurface(
      ui,
      popoverNodes({}).map((node) =>
        node.id === "o"
          ? { ...node, showOnHover: true, hoverOpenDelay: 200 }
          : node,
      ),
    );
    const popover = view.container.querySelector<HTMLElement>(
      "[data-a2ui-popover-trigger]",
    )!.parentElement!;
    view.act(() => popover.dispatchEvent(new Event("mouseenter")));
    expect(view.container.querySelector("[role=dialog]")).toBeNull();
    view.act(() => vi.advanceTimersByTime(200));
    expect(view.container.querySelector("[role=dialog]")).not.toBeNull();
    view.act(() => popover.dispatchEvent(new Event("mouseleave")));
    expect(view.container.querySelector("[role=dialog]")).toBeNull();
  });

  it("drops a pending hover open when the Popover is removed", () => {
    vi.useFakeTimers();
    const view = renderSurface(
      ui,
      popoverNodes({}).map((node) =>
        node.id === "o"
          ? { ...node, showOnHover: true, hoverOpenDelay: 200 }
          : node,
      ),
    );
    const timers = vi.getTimerCount();
    view.act(() =>
      view.container
        .querySelector<HTMLElement>("[data-a2ui-popover-trigger]")!
        .parentElement!.dispatchEvent(new Event("mouseenter")),
    );
    expect(vi.getTimerCount()).toBe(timers + 1);
    view.update(
      updateComponents({
        id: "root",
        component: "Column",
        children: ["outside"],
      }),
    );
    expect(
      view.container.querySelector("[data-a2ui-popover-trigger]"),
    ).toBeNull();
    expect(vi.getTimerCount()).toBe(timers);
  });
});

describe("standard feedback (standard catalog)", () => {
  it("names a PopoverTrigger by its envelope", () => {
    const view = renderSurface(standardUI, [
      { id: "root", component: "Popover", children: ["t", "c"] },
      {
        id: "t",
        component: "PopoverTrigger",
        children: ["i"],
        accessibility: { label: "More options" },
      },
      { id: "i", component: "Icon", name: "ellipsis" },
      { id: "c", component: "PopoverContent", children: ["x"] },
      { id: "x", component: "Text", text: "Options" },
    ]);
    const trigger = view.container.querySelector(
      'button[data-a2ui-popover-trigger][aria-label="More options"]',
    );
    expect(trigger).not.toBeNull();
  });

  it("Popover sideOffset moves the content and a block trigger fills the width", () => {
    const v = renderSurface(standardUI, [
      { id: "root", component: "Popover", children: ["t", "c"] },
      { id: "t", component: "PopoverTrigger", block: true, children: ["b"] },
      { id: "b", component: "Text", text: "Toggle" },
      { id: "c", component: "PopoverContent", sideOffset: 12, children: ["x"] },
      { id: "x", component: "Text", text: "Body" },
    ]);
    const trigger = byText(v.container, "Toggle").closest<HTMLElement>(
      "[data-a2ui-popover-trigger]",
    )!;
    expect(trigger.style.width).toBe("100%");
    click(v, trigger);
    const dialog = query<HTMLElement>(v.container, "[role=dialog]");
    expect(dialog.style.marginTop).toBe("12px");
  });
});

describe("Popover trigger", () => {
  it("toggles a Popover when its trigger is a Button", () => {
    const v = renderSurface(standardUI, [
      { id: "root", component: "Popover", children: ["t", "c"] },
      { id: "t", component: "PopoverTrigger", children: ["b"] },
      { id: "b", component: "Button", label: "Open", variant: "default" },
      { id: "c", component: "PopoverContent", children: ["x"] },
      { id: "x", component: "Text", text: "Popover body" },
    ]);
    // The trigger wrapper is a button too, so target the inner <button>.
    const button = v.container.querySelector<HTMLElement>(
      "[data-a2ui-popover-trigger] button",
    )!;
    expect(v.container.textContent).not.toContain("Popover body");
    v.act(() => button.click());
    expect(v.container.textContent).toContain("Popover body");
    v.act(() => button.click());
    expect(v.container.textContent).not.toContain("Popover body");
  });
});
