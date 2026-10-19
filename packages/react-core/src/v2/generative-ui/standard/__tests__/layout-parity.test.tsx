import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, waitFor } from "@testing-library/react";
import { STANDARD_CSS } from "../styles";
import { gridItemColumn } from "../layout";
import { standardUI } from "../index";
import { renderSurface } from "./render";

/**
 * Tests ported from the a2ui-renderer standard catalog, so the behaviour
 * that catalog had is kept on the generative UI engine.
 */

afterEach(() => {
  vi.unstubAllGlobals();
});

const render = (
  ...args: Parameters<typeof renderSurface> extends [unknown, ...infer Rest]
    ? Rest
    : never
) => renderSurface(standardUI, ...args);
const spacing = (steps: number) => `calc(var(--spacing, 0.25rem) * ${steps})`;

describe("standard catalog: layout and text (parity)", () => {
  it("Badge, Caption, Label, Divider, Spacer, Blockquote, Code, Link, Markdown render", async () => {
    const v = render([
      {
        id: "root",
        component: "Column",
        children: ["b", "c", "l", "d", "s", "q", "k", "a", "m"],
      },
      { id: "b", component: "Badge", label: "New", color: "success" },
      { id: "c", component: "Caption", text: "cap" },
      { id: "l", component: "Label", text: "lab" },
      { id: "d", component: "Divider" },
      { id: "s", component: "Spacer", minSize: 8 },
      { id: "q", component: "Blockquote", text: "quote" },
      { id: "k", component: "Code", text: "x = 1" },
      {
        id: "a",
        component: "Link",
        text: "docs",
        href: "https://copilotkit.ai",
      },
      { id: "m", component: "Markdown", text: "# H\n\n- one" },
    ]);
    expect(await v.findByText("New")).toBeTruthy();
    expect(v.getByText("quote").closest("blockquote")).not.toBeNull();
    expect(v.getByText("docs").getAttribute("href")).toBe(
      "https://copilotkit.ai",
    );
    expect(v.getByText("x = 1").closest("pre")).not.toBeNull();
    expect(v.container.querySelector("hr")).not.toBeNull();
    await waitFor(() =>
      expect(v.container.querySelector("h1")?.textContent).toBe("H"),
    );
    expect(v.container.querySelector("li")!.textContent).toBe("one");
  });

  it("Italic, Underline and Strikethrough render as inline elements", async () => {
    const v = render([
      { id: "root", component: "Text", text: "Was", children: ["i", "u", "s"] },
      { id: "i", component: "Italic", text: "it" },
      { id: "u", component: "Underline", text: "un" },
      { id: "s", component: "Strikethrough", text: "st" },
    ]);
    expect((await v.findByText("it")).tagName).toBe("EM");
    expect(v.getByText("un").tagName).toBe("U");
    expect(v.getByText("st").tagName).toBe("S");
  });

  it("Blockquote renders inline markdown in its text", async () => {
    const v = render([
      { id: "root", component: "Blockquote", text: "A **bold** claim" },
    ]);
    const strong = await v.findByText("bold");
    expect(strong.tagName).toBe("STRONG");
    expect(strong.closest("blockquote")!.style.borderLeft).toContain(
      "3px solid",
    );
  });

  it.each(["Column", "Grid", "Card", "Row", "Box", "Carousel", "Flow"])(
    "%s repeats a template child per data item",
    async (component) => {
      const v = render(
        [
          {
            id: "root",
            component,
            children: { componentId: "row", path: "/items" },
          },
          { id: "row", component: "Text", text: { "@path": "name" } },
        ],
        { items: [{ name: "Alpha" }, { name: "Beta" }] },
      );
      expect(await v.findByText("Alpha")).toBeTruthy();
      expect(await v.findByText("Beta")).toBeTruthy();
    },
  );

  it("centres Row children by default and keeps text from stretching", async () => {
    const v = render([
      { id: "root", component: "Column", children: ["r1", "r2"] },
      {
        id: "r1",
        component: "Row",
        justify: "between",
        children: ["k", "val"],
      },
      { id: "k", component: "Text", text: "Price" },
      { id: "val", component: "Text", text: "$29.00", tabularNums: true },
      { id: "r2", component: "Row", align: "start", children: ["s"] },
      { id: "s", component: "Text", text: "top" },
    ]);
    const value = await v.findByText("$29.00");
    const row = value.parentElement!;
    expect(row.style.alignItems).toBe("center");
    expect(row.dataset.a2uiRow).toBe("between");
    expect(value.style.flex).toBe("0 1 auto");
    expect(value.style.minWidth).toMatch(/^0(px)?$/);
    expect(value.style.width).toBe("");
    expect(value.style.fontVariantNumeric).toBe("tabular-nums");
    expect((await v.findByText("top")).parentElement!.style.alignItems).toBe(
      "flex-start",
    );
    expect(STANDARD_CSS).toContain(
      '[data-a2ui-row="between"]>[data-a2ui-text]:last-child:not(:first-child){text-align:right',
    );
  });

  it("Carousel renders previous/next arrows with custom labels", async () => {
    const v = render([
      {
        id: "root",
        component: "Carousel",
        previousLabel: "Back",
        nextLabel: "Forward",
        label: "Slides",
        children: ["a", "b"],
      },
      { id: "a", component: "CarouselItem", children: ["ta"] },
      { id: "ta", component: "Text", text: "One" },
      { id: "b", component: "CarouselItem", children: ["tb"] },
      { id: "tb", component: "Text", text: "Two" },
    ]);
    await v.findByText("One");
    expect(v.getByRole("button", { name: "Back" })).not.toBeNull();
    expect(v.getByRole("button", { name: "Forward" })).not.toBeNull();
    expect(v.getByRole("region", { name: "Slides" })).not.toBeNull();
  });

  it("Carousel writes the snapped slide to a bound activeIndex", async () => {
    const v = render(
      [
        {
          id: "root",
          component: "Carousel",
          activeIndex: { "@path": "/slide" },
          children: ["a", "b"],
        },
        { id: "a", component: "CarouselItem", children: ["ta"] },
        { id: "ta", component: "Text", text: "One" },
        { id: "b", component: "CarouselItem", children: ["tb"] },
        { id: "tb", component: "Text", text: "Two" },
      ],
      { slide: 0 },
    );
    await v.findByText("One");
    const scroller = v.container.querySelector("[data-a2ui-carousel]")!;
    vi.useFakeTimers();
    fireEvent.scroll(scroller);
    vi.advanceTimersByTime(200);
    vi.useRealTimers();
    // jsdom has no layout, so every slide sits at offset 0 and the nearest is 0.
    expect(v.dataAt("/slide")).toBe(0);
  });

  it("layout props: flush removes padding, disableAutoSpacing removes the default gap, role is applied", async () => {
    const v = render([
      { id: "root", component: "Column", children: ["c"] },
      {
        id: "c",
        component: "Card",
        flush: true,
        disableAutoSpacing: true,
        role: "group",
        children: ["t"],
      },
      { id: "t", component: "Text", text: "Inside" },
    ]);
    const card = (await v.findByText("Inside")).parentElement as HTMLElement;
    expect(card.getAttribute("role")).toBe("group");
    expect(["0", "0px"]).toContain(card.style.padding);
    expect(["0", "0px"]).toContain(card.style.gap);
  });

  it("minSize and maxSize set both dimensions of a container", async () => {
    const v = render([
      {
        id: "root",
        component: "Box",
        minSize: 10,
        maxSize: 40,
        children: ["t"],
      },
      { id: "t", component: "Text", text: "Sized" },
    ]);
    const box = (await v.findByText("Sized")).parentElement as HTMLElement;
    expect(box.style.minWidth).toBe(spacing(10));
    expect(box.style.minHeight).toBe(spacing(10));
    expect(box.style.maxWidth).toBe(spacing(40));
    expect(box.style.maxHeight).toBe(spacing(40));
  });

  it("Card size and shadowStyle presets apply", async () => {
    const v = render([
      {
        id: "root",
        component: "Card",
        size: "sm",
        shadowStyle: "md",
        children: ["t"],
      },
      { id: "t", component: "Text", text: "Small" },
    ]);
    const card = (await v.findByText("Small")).parentElement as HTMLElement;
    expect(card.style.padding).toBe(spacing(2));
    expect(card.style.boxShadow).toContain("--a2ui-shadow-md");
  });

  it("Text fontSize, lineHeight and minLines", async () => {
    const v = render([
      {
        id: "root",
        component: "Text",
        text: "Tall",
        fontSize: 18,
        lineHeight: 1.2,
        minLines: 3,
      },
    ]);
    const el = (await v.findByText("Tall")) as HTMLElement;
    expect(el.style.fontSize).toBe("18px");
    expect(el.style.lineHeight).toBe("1.2");
    expect(el.style.minHeight).toBe("4.5em");
  });

  it("onVisible dispatches once when the container becomes visible", async () => {
    let callback:
      | ((entries: Array<{ isIntersecting: boolean }>) => void)
      | null = null;
    class FakeObserver {
      constructor(cb: typeof callback) {
        callback = cb;
      }
      observe() {}
      disconnect() {}
    }
    vi.stubGlobal("IntersectionObserver", FakeObserver);
    const v = render([
      {
        id: "root",
        component: "Column",
        onVisible: { event: { name: "seen" } },
        children: ["t"],
      },
      { id: "t", component: "Text", text: "Hi" },
    ]);
    await v.findByText("Hi");
    await waitFor(() => expect(callback).not.toBeNull());
    callback!([{ isIntersecting: true }]);
    callback!([{ isIntersecting: true }]);
    expect(v.forwardEvent).toHaveBeenCalledTimes(1);
    expect(v.forwardEvent.mock.calls[0][0].name).toBe("seen");
  });
});

describe("standard catalog: tooltip (parity)", () => {
  it("Tooltip hugs its trigger instead of stretching across the column", async () => {
    const v = render([
      { id: "root", component: "Column", children: ["tip"] },
      { id: "tip", component: "Tooltip", trigger: "t", content: "c" },
      { id: "t", component: "Text", text: "Hover me" },
      { id: "c", component: "Text", text: "Tip" },
    ]);
    const wrapper = (await v.findByText("Hover me")).closest(
      "[data-a2ui-tooltip-trigger]",
    )!.parentElement as HTMLElement;
    expect(wrapper.style.alignSelf).toBe("flex-start");
    expect(wrapper.style.width).toBe("max-content");
  });
});

describe("standard catalog: GridItem span (parity)", () => {
  it("clamps spans that cover every column to the full row", () => {
    expect(gridItemColumn(undefined, 3)).toBeUndefined();
    expect(gridItemColumn(2, 3)).toBe("span 2");
    expect(gridItemColumn(3, 3)).toBe("1 / -1");
    expect(gridItemColumn(5, 2)).toBe("1 / -1");
    expect(gridItemColumn(2, 1)).toBe("1 / -1");
    expect(gridItemColumn(2, undefined)).toBe("span 2");
  });

  it("GridItem with span > columns fills the row instead of overflowing", async () => {
    const v = render([
      { id: "root", component: "Grid", columns: 2, children: ["a", "b"] },
      { id: "a", component: "GridItem", span: 4, children: ["ta"] },
      { id: "ta", component: "Text", text: "Wide" },
      { id: "b", component: "GridItem", span: 1, children: ["tb"] },
      { id: "tb", component: "Text", text: "Narrow" },
    ]);
    const wide = (await v.findByText("Wide")).parentElement!;
    const narrow = v.getByText("Narrow").parentElement!;
    expect(wide.style.gridColumn).toBe("1 / -1");
    expect(narrow.style.gridColumn).toBe("span 1");
  });
});
