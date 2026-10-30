import { afterEach, describe, expect, it, vi } from "vitest";
import { renderSurface } from "../../../__tests__/render";
import { standardUI } from "../../index";
import { byText, lightbox, shownSrc, tick } from "../../../__tests__/dom";
import { parentOf, ui } from "./helpers";

afterEach(() => {
  vi.useRealTimers();
});

describe("standard layout", () => {
  it("makes a Carousel a focusable scroll region, named by its label", () => {
    const view = renderSurface(ui, [
      {
        id: "root",
        component: "Carousel",
        label: "Plans",
        previousLabel: "Back",
        nextLabel: "Forward",
        children: ["i"],
      },
      { id: "i", component: "CarouselItem", children: ["t"] },
      { id: "t", component: "Label", text: "slide" },
    ]);
    const carousel = view.container.querySelector<HTMLElement>(
      '[role="region"][aria-label="Plans"]',
    )!;
    expect(carousel.tabIndex).toBe(0);
    expect(carousel.hasAttribute("data-a2ui-carousel")).toBe(true);
    expect(carousel.getAttribute("aria-roledescription")).toBe("carousel");
    expect(carousel.style.overflowX).toBe("auto");
    expect(carousel.style.scrollSnapType).toBe("x proximity");
    expect(parentOf(view, "slide").parentElement).toBe(carousel);
    expect(
      view.container.querySelector('button[aria-label="Back"]'),
    ).not.toBeNull();
    expect(
      view.container.querySelector('button[aria-label="Forward"]'),
    ).not.toBeNull();
  });

  it("Carousel writes the snapped slide to a bound activeIndex", () => {
    const view = renderSurface(
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
    const scroller = view.container.querySelector("[data-a2ui-carousel]")!;
    expect(view.dataAt("/slide")).toBe(1);
    vi.useFakeTimers();
    scroller.dispatchEvent(new Event("scroll"));
    vi.advanceTimersByTime(200);
    vi.useRealTimers();
    // jsdom has no layout, so every slide sits at offset 0 and the nearest is 0.
    expect(view.dataAt("/slide")).toBe(0);
  });

  it("sizes the slides so visibleItems of them fill the Carousel, gaps included", () => {
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
    expect(parentOf(view, "Two per view").style.width).toMatch(
      /^calc\(\(100% - 1 \* calc\(var\(--spacing.*\) \/ 2\)$/,
    );
    expect(parentOf(view, "Content width").style.width).toBe("");
  });
});

describe("standard layout (standard catalog)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    document.querySelector(".cdk-overlay-container")?.remove();
  });

  it("CarouselMediaItem opens a lightbox over every slide of its carousel", () => {
    const v = renderSurface(standardUI, [
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
    v.act(() =>
      v.container.querySelector<HTMLElement>('img[alt="B"]')!.click(),
    );
    expect(shownSrc()).toBe("https://example.com/b.png");
    expect(lightbox()!.textContent).toContain("2 / 3");
    lightbox()!
      .querySelector<HTMLElement>("[data-a2ui-lightbox-arrow=next]")!
      .click();
    tick();
    expect(shownSrc()).toBe("https://example.com/c.png");
  });

  it("CarouselMediaItem with href opens the URL instead of the lightbox", () => {
    const open = vi.spyOn(window, "open").mockImplementation(() => null);
    const v = renderSurface(standardUI, [
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
    const linked = v.container.querySelector<HTMLElement>('img[alt="A"]')!;
    expect(linked.hasAttribute("data-a2ui-lightbox-trigger")).toBe(false);
    expect(linked.style.cursor).toBe("pointer");
    v.act(() => linked.click());
    expect(open).toHaveBeenCalledWith(
      "https://copilotkit.ai",
      "_blank",
      "noopener,noreferrer",
    );
    expect(lightbox()).toBeNull();
    const plain = v.container.querySelector<HTMLElement>('img[alt="B"]')!;
    expect(plain.hasAttribute("data-a2ui-lightbox-trigger")).toBe(true);
    expect(plain.style.cursor).toBe("zoom-in");
  });

  it("CarouselMediaItem renders its image at the size's width", () => {
    const v = renderSurface(standardUI, [
      { id: "root", component: "Carousel", children: ["a", "b"] },
      {
        id: "a",
        component: "CarouselMediaItem",
        url: "https://example.com/a.png",
        description: "slide",
        size: "sm",
        children: ["t"],
      },
      { id: "t", component: "Caption", text: "Slide A" },
      {
        id: "b",
        component: "CarouselMediaItem",
        url: "https://example.com/b.png",
        description: "wide",
        size: "lg",
      },
    ]);
    const items = [
      ...v.container.querySelectorAll<HTMLElement>(
        "[data-a2ui-carousel-media]",
      ),
    ];
    expect(items.map((item) => item.style.width)).toEqual(["160px", "320px"]);
    expect(items[0]!.style.scrollSnapAlign).toBe("start");
    expect(items[0]!.querySelector("img")?.getAttribute("alt")).toBe("slide");
    expect(byText(v.container, "Slide A")).toBeTruthy();
  });
});
