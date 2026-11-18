import { fireEvent, render, waitFor } from "@testing-library/vue";
import { h } from "vue";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderSurface } from "../../../__tests__/helpers/render-surface";
import { gridItemColumn } from "../layout";
import CopilotGenerativeUICarousel from "../Carousel.vue";
import CopilotGenerativeUITabs from "../Tabs.vue";
import { parentOf, spacing, ui } from "./helpers";

/**
 * Tests ported from the former React standard catalog (React's
 * layout-parity.test.tsx), the layout specs of the Angular port, and the
 * "standard Tabs" case of React's child-refs.test.tsx. A test-only Label
 * stands in for Text, so the layout group needs no other group.
 */

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

const lightbox = () =>
  document.querySelector<HTMLElement>("[data-a2ui-lightbox]");
const shownSrc = () => lightbox()?.querySelector("img")?.getAttribute("src");
const panelText = (view: ReturnType<typeof renderSurface>) =>
  view.getByRole("tabpanel").textContent?.trim();

describe("standard catalog: layout and text (parity)", () => {
  it.each(["Column", "Grid", "Card", "Row", "Box", "Carousel", "Flow"])(
    "%s repeats a template child per data item",
    async (component) => {
      const v = renderSurface(
        ui,
        [
          {
            id: "root",
            component,
            children: { componentId: "row", path: "/items" },
          },
          { id: "row", component: "Label", text: { "@path": "name" } },
        ],
        { items: [{ name: "Alpha" }, { name: "Beta" }] },
      );
      expect(await v.findByText("Alpha")).toBeTruthy();
      expect(await v.findByText("Beta")).toBeTruthy();
    },
  );

  it("Carousel renders previous/next arrows with custom labels", async () => {
    const v = renderSurface(ui, [
      {
        id: "root",
        component: "Carousel",
        previousLabel: "Back",
        nextLabel: "Forward",
        label: "Slides",
        children: ["a", "b"],
      },
      { id: "a", component: "CarouselItem", children: ["ta"] },
      { id: "ta", component: "Label", text: "One" },
      { id: "b", component: "CarouselItem", children: ["tb"] },
      { id: "tb", component: "Label", text: "Two" },
    ]);
    await v.findByText("One");
    // jsdom has no layout, so both arrows are disabled: query hidden ones too.
    expect(v.getByRole("button", { name: "Back", hidden: true })).toBeTruthy();
    expect(
      v.getByRole("button", { name: "Forward", hidden: true }),
    ).toBeTruthy();
    expect(v.getByRole("region", { name: "Slides" })).toBeTruthy();
  });

  it("Carousel writes the snapped slide to a bound activeIndex", async () => {
    const v = renderSurface(
      ui,
      [
        {
          id: "root",
          component: "Carousel",
          activeIndex: { "@path": "/slide" },
          children: ["a", "b"],
        },
        { id: "a", component: "CarouselItem", children: ["ta"] },
        { id: "ta", component: "Label", text: "One" },
        { id: "b", component: "CarouselItem", children: ["tb"] },
        { id: "tb", component: "Label", text: "Two" },
      ],
      { slide: 1 },
    );
    await v.findByText("One");
    const scroller = v.container.querySelector("[data-a2ui-carousel]")!;
    expect(v.dataAt("/slide")).toBe(1);
    vi.useFakeTimers();
    await fireEvent.scroll(scroller);
    vi.advanceTimersByTime(200);
    vi.useRealTimers();
    // jsdom has no layout, so every slide sits at offset 0 and the nearest is 0.
    expect(v.dataAt("/slide")).toBe(0);
  });

  it("layout props: flush removes padding, disableAutoSpacing removes the default gap, role is applied", async () => {
    const v = renderSurface(ui, [
      { id: "root", component: "Column", children: ["c"] },
      {
        id: "c",
        component: "Card",
        flush: true,
        disableAutoSpacing: true,
        role: "group",
        children: ["t"],
      },
      { id: "t", component: "Label", text: "Inside" },
    ]);
    const card = await parentOf(v, "Inside");
    expect(card.getAttribute("role")).toBe("group");
    expect(["0", "0px"]).toContain(card.style.padding);
    expect(["0", "0px"]).toContain(card.style.gap);
  });

  it("minSize and maxSize set both dimensions of a container", async () => {
    const v = renderSurface(ui, [
      {
        id: "root",
        component: "Box",
        minSize: 10,
        maxSize: 40,
        children: ["t"],
      },
      { id: "t", component: "Label", text: "Sized" },
    ]);
    const box = await parentOf(v, "Sized");
    expect(box.style.minWidth).toBe(spacing(10));
    expect(box.style.minHeight).toBe(spacing(10));
    expect(box.style.maxWidth).toBe(spacing(40));
    expect(box.style.maxHeight).toBe(spacing(40));
  });

  it("Card size and shadowStyle presets apply", async () => {
    const v = renderSurface(ui, [
      {
        id: "root",
        component: "Card",
        size: "sm",
        shadowStyle: "md",
        children: ["t"],
      },
      { id: "t", component: "Label", text: "Small" },
    ]);
    const card = await parentOf(v, "Small");
    expect(card.style.padding).toBe(spacing(2));
    expect(card.style.boxShadow).toContain("--a2ui-shadow-md");
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
    const v = renderSurface(ui, [
      {
        id: "root",
        component: "Column",
        onVisible: { event: { name: "seen" } },
        children: ["t"],
      },
      { id: "t", component: "Label", text: "Hi" },
    ]);
    await v.findByText("Hi");
    await waitFor(() => expect(callback).not.toBeNull());
    callback!([{ isIntersecting: true }]);
    callback!([{ isIntersecting: true }]);
    expect(v.forwardEvent).toHaveBeenCalledTimes(1);
    expect(v.forwardEvent.mock.calls[0]![0].name).toBe("seen");
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
    const v = renderSurface(ui, [
      { id: "root", component: "Grid", columns: 2, children: ["a", "b"] },
      { id: "a", component: "GridItem", span: 4, children: ["ta"] },
      { id: "ta", component: "Label", text: "Wide" },
      { id: "b", component: "GridItem", span: 1, children: ["tb"] },
      { id: "tb", component: "Label", text: "Narrow" },
    ]);
    const wide = await parentOf(v, "Wide");
    const narrow = await parentOf(v, "Narrow");
    expect(wide.style.gridColumn).toBe("1 / -1");
    expect(narrow.style.gridColumn).toBe("span 1");
  });
});

describe("standard Tabs", () => {
  it("renders Tabs from typed child references", async () => {
    const v = renderSurface(ui, [
      {
        id: "root",
        component: "Tabs",
        tabs: [
          { title: "One", child: "a" },
          { title: "Two", child: "b" },
        ],
      },
      { id: "a", component: "Label", text: "panel one" },
      { id: "b", component: "Label", text: "panel two" },
    ]);
    expect((await v.findByRole("tabpanel")).textContent).toBe("panel one");
    await fireEvent.click(v.getByRole("tab", { name: "Two" }));
    expect(v.getByRole("tabpanel").textContent).toBe("panel two");
    expect(v.reportError).not.toHaveBeenCalled();
  });
});

// The cases below come from the Angular port's layout specs.

describe("standard layout (Angular parity)", () => {
  it("renders the child slot of a Card before its children", async () => {
    const view = renderSurface(ui, [
      { id: "root", component: "Card", child: "head", children: ["body"] },
      { id: "head", component: "Label", text: "Head" },
      { id: "body", component: "Label", text: "Body" },
    ]);
    const card = await parentOf(view, "Head");
    expect([...card.children].map((el) => el.textContent?.trim())).toEqual([
      "Head",
      "Body",
    ]);
  });

  it("sizes the slides so visibleItems of them fill the Carousel, gaps included", async () => {
    const view = renderSurface(ui, [
      { id: "root", component: "Column", children: ["fixed", "free"] },
      {
        id: "fixed",
        component: "Carousel",
        visibleItems: 2,
        gap: 3,
        children: ["a"],
      },
      { id: "a", component: "CarouselItem", children: ["ta"] },
      { id: "ta", component: "Label", text: "Two per view" },
      { id: "free", component: "Carousel", children: ["b"] },
      { id: "b", component: "CarouselItem", children: ["tb"] },
      { id: "tb", component: "Label", text: "Content width" },
    ]);
    // One gap between two slides, in the theme's spacing token.
    expect((await parentOf(view, "Two per view")).style.width).toMatch(
      /^calc\(\(100% - 1 \* calc\(var\(--spacing.*\) \/ 2\)$/,
    );
    expect((await parentOf(view, "Content width")).style.width).toBe("");
  });

  it("renders Tabs with one panel at a time and switches on click and arrow keys", async () => {
    const view = renderSurface(ui, [
      {
        id: "root",
        component: "Tabs",
        tabs: [
          { title: "Specs", child: "specs" },
          { title: "Reviews", child: "reviews" },
        ],
      },
      { id: "specs", component: "Label", text: "The specs" },
      { id: "reviews", component: "Label", text: "The reviews" },
    ]);
    const tabs = await view.findAllByRole("tab");
    expect(tabs.map((tab) => tab.textContent?.trim())).toEqual([
      "Specs",
      "Reviews",
    ]);
    expect(tabs[0]!.getAttribute("aria-selected")).toBe("true");
    expect(tabs[0]!.tabIndex).toBe(0);
    expect(tabs[1]!.tabIndex).toBe(-1);
    expect(panelText(view)).toBe("The specs");
    await fireEvent.click(tabs[1]!);
    expect(panelText(view)).toBe("The reviews");
    expect(tabs[1]!.getAttribute("aria-selected")).toBe("true");
    await fireEvent.keyDown(view.getByRole("tablist"), { key: "ArrowRight" });
    // Wraps around to the first tab.
    expect(tabs[0]!.getAttribute("aria-selected")).toBe("true");
    expect(panelText(view)).toBe("The specs");
  });

  it("writes the selected tab to a bound selectedIndex", async () => {
    const view = renderSurface(
      ui,
      [
        {
          id: "root",
          component: "Tabs",
          selectedIndex: { "@path": "/tab" },
          tabs: [
            { title: "A", child: "a" },
            { title: "B", child: "b" },
          ],
        },
        { id: "a", component: "Label", text: "Panel A" },
        { id: "b", component: "Label", text: "Panel B" },
      ],
      { tab: 1 },
    );
    expect((await view.findByRole("tabpanel")).textContent?.trim()).toBe(
      "Panel B",
    );
    await fireEvent.click(view.getByRole("tab", { name: "A" }));
    expect(view.dataAt("/tab")).toBe(0);
    expect(panelText(view)).toBe("Panel A");
  });

  it("CarouselMediaItem opens a lightbox over every slide of its carousel", async () => {
    const v = renderSurface(ui, [
      { id: "root", component: "Carousel", children: ["a", "b", "c"] },
      {
        id: "a",
        component: "CarouselMediaItem",
        url: "https://example.com/a.png",
        description: "A",
      },
      {
        id: "b",
        component: "CarouselMediaItem",
        url: "https://example.com/b.png",
        description: "B",
      },
      {
        id: "c",
        component: "CarouselMediaItem",
        url: "https://example.com/c.png",
        description: "C",
      },
    ]);
    await fireEvent.click(await v.findByAltText("B"));
    expect(shownSrc()).toBe("https://example.com/b.png");
    expect(lightbox()!.textContent).toContain("2 / 3");
    await fireEvent.click(
      lightbox()!.querySelector("[data-a2ui-lightbox-arrow=next]")!,
    );
    expect(shownSrc()).toBe("https://example.com/c.png");
    await fireEvent.click(lightbox()!);
    expect(lightbox()).toBeNull();
  });

  it("CarouselMediaItem with href opens the URL instead of the lightbox", async () => {
    const open = vi.spyOn(window, "open").mockImplementation(() => null);
    const v = renderSurface(ui, [
      { id: "root", component: "Carousel", children: ["a", "b"] },
      {
        id: "a",
        component: "CarouselMediaItem",
        url: "https://example.com/a.png",
        description: "A",
        href: "https://copilotkit.ai",
      },
      {
        id: "b",
        component: "CarouselMediaItem",
        url: "https://example.com/b.png",
        description: "B",
      },
    ]);
    const linked = await v.findByAltText("A");
    expect(linked.hasAttribute("data-a2ui-lightbox-trigger")).toBe(false);
    expect(linked.style.cursor).toBe("pointer");
    await fireEvent.click(linked);
    expect(open).toHaveBeenCalledWith(
      "https://copilotkit.ai",
      "_blank",
      "noopener,noreferrer",
    );
    expect(lightbox()).toBeNull();
    const plain = v.getByAltText("B");
    expect(plain.hasAttribute("data-a2ui-lightbox-trigger")).toBe(true);
    expect(plain.style.cursor).toBe("zoom-in");
  });

  it("CarouselMediaItem renders its image at the size's width", async () => {
    const v = renderSurface(ui, [
      { id: "root", component: "Carousel", children: ["a", "b"] },
      {
        id: "a",
        component: "CarouselMediaItem",
        url: "https://example.com/a.png",
        description: "slide",
        size: "sm",
        children: ["t"],
      },
      { id: "t", component: "Label", text: "Slide A" },
      {
        id: "b",
        component: "CarouselMediaItem",
        url: "https://example.com/b.png",
        description: "wide",
        size: "lg",
      },
    ]);
    expect(await v.findByText("Slide A")).toBeTruthy();
    const items = [
      ...v.container.querySelectorAll<HTMLElement>(
        "[data-a2ui-carousel-media]",
      ),
    ];
    expect(items.map((item) => item.style.width)).toEqual(["160px", "320px"]);
    expect(items[0]!.style.scrollSnapAlign).toBe("start");
    expect(items[0]!.querySelector("img")?.getAttribute("alt")).toBe("slide");
  });
});

describe("standard layout (Vue-specific semantics)", () => {
  const twoTabs = [
    { title: "One", child: h("p", "first panel") },
    { title: "Two", child: h("p", "second panel") },
  ];

  it("Tabs keeps its own selection when selectedIndex is not bound", async () => {
    const view = render(CopilotGenerativeUITabs, { props: { tabs: twoTabs } });
    await fireEvent.click(view.getByRole("tab", { name: "Two" }));
    expect(view.getByRole("tabpanel").textContent).toBe("second panel");
    expect(view.emitted("update:selectedIndex")).toEqual([[1]]);
  });

  it("Tabs follows a v-model selectedIndex", async () => {
    const view = render(CopilotGenerativeUITabs, {
      props: { tabs: twoTabs, selectedIndex: 1 },
    });
    expect(view.getByRole("tabpanel").textContent).toBe("second panel");
    await view.rerender({ tabs: twoTabs, selectedIndex: 0 });
    expect(view.getByRole("tabpanel").textContent).toBe("first panel");
  });

  it("Tabs moves the focus to the tab that Home or End opens", async () => {
    const view = render(CopilotGenerativeUITabs, {
      props: { tabs: twoTabs },
      attachTo: document.body,
    });
    const list = view.getByRole("tablist");
    await fireEvent.keyDown(list, { key: "End" });
    expect(document.activeElement).toBe(view.getByRole("tab", { name: "Two" }));
    expect(view.getByRole("tabpanel").textContent).toBe("second panel");
    await fireEvent.keyDown(list, { key: "Home" });
    expect(document.activeElement).toBe(view.getByRole("tab", { name: "One" }));
  });

  it("Tabs renders nothing without tabs", () => {
    const view = render(CopilotGenerativeUITabs, { props: { tabs: [] } });
    expect(view.container.querySelector("[data-a2ui-tabs]")).toBeNull();
  });

  it("Carousel emits update:activeIndex when a scroll settles on another slide", async () => {
    const view = render(CopilotGenerativeUICarousel, {
      props: { activeIndex: 2 },
      slots: { children: () => [h("div", "a"), h("div", "b")] },
    });
    vi.useFakeTimers();
    await fireEvent.scroll(
      view.container.querySelector("[data-a2ui-carousel]")!,
    );
    vi.advanceTimersByTime(200);
    expect(view.emitted("update:activeIndex")).toEqual([[0]]);
  });

  it("Carousel hides its arrows when showArrows is false", () => {
    const view = render(CopilotGenerativeUICarousel, {
      props: { showArrows: false },
    });
    expect(view.container.querySelector("button")).toBeNull();
  });

  it("CarouselMediaItem sends a bound onClick instead of opening the lightbox", async () => {
    const v = renderSurface(ui, [
      { id: "root", component: "Carousel", children: ["a"] },
      {
        id: "a",
        component: "CarouselMediaItem",
        url: "https://example.com/a.png",
        description: "A",
        onClick: { event: { name: "open-plan" } },
      },
    ]);
    const image = await v.findByAltText("A");
    expect(image.style.cursor).toBe("pointer");
    await fireEvent.click(image);
    expect(lightbox()).toBeNull();
    expect(v.forwardEvent).toHaveBeenCalledTimes(1);
    expect(v.forwardEvent.mock.calls[0]![0].name).toBe("open-plan");
  });
});
