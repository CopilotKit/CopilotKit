import { afterEach, describe, expect, it, vi } from "vitest";
import { renderSurface } from "../../../__tests__/render";
import { key, lightbox, shownSrc, tick, ui } from "./helpers";

afterEach(() => {
  vi.restoreAllMocks();
  document.querySelector(".cdk-overlay-container")?.remove();
});

describe("standard catalog: composites", () => {
  it("ImageGrid renders every image and opens the lightbox on click", () => {
    const v = renderSurface(ui, [
      {
        id: "root",
        component: "ImageGrid",
        layout: "bento",
        images: [
          { url: "https://example.com/1.png", description: "one" },
          {
            url: "https://example.com/2.png",
            description: "two",
            caption: "Two",
          },
          { url: "https://example.com/3.png", description: "three" },
        ],
      },
    ]);
    const grid = v.container.querySelector<HTMLElement>(
      "[data-a2ui-image-grid]",
    )!;
    const images = grid.querySelectorAll("img");
    expect(images).toHaveLength(3);
    expect(grid.style.gridTemplateColumns).toBe("repeat(3, minmax(0, 1fr))");
    expect(images[0]?.closest("figure")?.style.gridRow).toBe("span 2");
    expect(grid.textContent).toContain("Two");
    v.act(() => images[0]!.click());
    expect(shownSrc()).toBe("https://example.com/1.png");
    v.act(() => lightbox()!.click());
    expect(lightbox()).toBeNull();
  });

  it("ImageGrid lightbox walks through all images with the arrows and keys", () => {
    const v = renderSurface(ui, [
      {
        id: "root",
        component: "ImageGrid",
        images: [
          { url: "https://example.com/1.png", description: "one" },
          { url: "https://example.com/2.png", description: "two" },
          { url: "https://example.com/3.png", description: "three" },
        ],
      },
    ]);
    const images = v.container.querySelectorAll("img");
    v.act(() => images[1]!.click());
    expect(shownSrc()).toBe("https://example.com/2.png");
    expect(lightbox()!.textContent).toContain("2 / 3");
    lightbox()!
      .querySelector<HTMLElement>("[data-a2ui-lightbox-arrow=next]")!
      .click();
    tick();
    expect(shownSrc()).toBe("https://example.com/3.png");
    const key = (name: string) =>
      document.body.dispatchEvent(
        new KeyboardEvent("keydown", { key: name, bubbles: true }),
      );
    key("ArrowRight");
    tick();
    expect(shownSrc()).toBe("https://example.com/1.png");
    key("ArrowLeft");
    tick();
    expect(shownSrc()).toBe("https://example.com/3.png");
    key("Escape");
    tick();
    expect(lightbox()).toBeNull();
  });

  it("ImageGrid opens the href of an image instead of the lightbox", () => {
    const open = vi.spyOn(window, "open").mockImplementation(() => null);
    const v = renderSurface(ui, [
      {
        id: "root",
        component: "ImageGrid",
        images: [
          { url: "https://example.com/1.png", href: "https://example.com" },
        ],
      },
    ]);
    v.act(() => v.container.querySelector("img")!.click());
    expect(open).toHaveBeenCalledWith(
      "https://example.com",
      "_blank",
      "noopener,noreferrer",
    );
    expect(lightbox()).toBeNull();
  });
});
